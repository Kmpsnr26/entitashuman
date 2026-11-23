import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../alecore-ai/brain/event-bus.js';
import {createSkillRegistry} from '../alecore-ai/skills/registry.js';
import {
  SKILL_EXECUTION_STATUS,
  SKILL_EXECUTION_REASON,
  createSkillExecutor
} from '../alecore-ai/execution/index.js';

const allow=(skillId,id='decision-1')=>({
  id,
  outcome:'ALLOW',
  capability:skillId
});

test('Skill Executor runs only an explicitly registered handler with matching ALLOW decision',async()=>{
  const executor=createSkillExecutor();
  executor.register({
    id:'reason',
    handler:async input=>({answer:input.value+1})
  });
  const result=await executor.execute({
    skillId:'reason',
    input:{value:2},
    decision:allow('reason')
  });
  assert.equal(result.status,SKILL_EXECUTION_STATUS.COMPLETED);
  assert.deepEqual(result.output,{answer:3});
  assert.equal(executor.snapshot().counters.completed,1);
});

test('Skill Executor blocks missing, non-ALLOW, and capability-mismatched decisions',async()=>{
  const executor=createSkillExecutor();
  executor.register({id:'reason',handler:()=>({ok:true})});

  const missing=await executor.execute({skillId:'reason'});
  assert.equal(missing.status,SKILL_EXECUTION_STATUS.BLOCKED);
  assert.equal(missing.reason,SKILL_EXECUTION_REASON.DECISION_REQUIRED);

  const denied=await executor.execute({
    skillId:'reason',
    decision:{id:'d2',outcome:'BLOCK',capability:'reason'}
  });
  assert.equal(denied.reason,SKILL_EXECUTION_REASON.DECISION_NOT_ALLOWED);

  const mismatch=await executor.execute({
    skillId:'reason',
    decision:allow('plan','d3')
  });
  assert.equal(mismatch.reason,SKILL_EXECUTION_REASON.CAPABILITY_MISMATCH);
});

test('Skill Executor blocks unknown and disabled local handlers',async()=>{
  const executor=createSkillExecutor();
  const unknown=await executor.execute({
    skillId:'reason',
    decision:allow('reason')
  });
  assert.equal(unknown.reason,SKILL_EXECUTION_REASON.SKILL_NOT_REGISTERED);

  executor.register({id:'plan',enabled:false,handler:()=>({ok:true})});
  const disabled=await executor.execute({
    skillId:'plan',
    decision:allow('plan')
  });
  assert.equal(disabled.reason,SKILL_EXECUTION_REASON.SKILL_DISABLED);
});

test('Skill Executor respects AleCore AI Skill Registry enabled state and updates counters',async()=>{
  const registry=createSkillRegistry();
  const executor=createSkillExecutor({registry});
  executor.register({id:'reason',handler:()=>({ok:true})});

  const complete=await executor.execute({
    skillId:'reason',
    decision:allow('reason','registry-1')
  });
  assert.equal(complete.status,SKILL_EXECUTION_STATUS.COMPLETED);
  assert.equal(registry.get('reason').runs,1);
  assert.equal(registry.get('reason').successes,1);

  registry.setEnabled('reason',false);
  const blocked=await executor.execute({
    skillId:'reason',
    decision:allow('reason','registry-2')
  });
  assert.equal(blocked.reason,SKILL_EXECUTION_REASON.REGISTRY_SKILL_UNAVAILABLE);
});

test('Skill Executor validates input and output size/shape',async()=>{
  const executor=createSkillExecutor({
    limits:{maxInputBytes:64,maxOutputBytes:64}
  });
  executor.register({id:'reason',handler:input=>input});

  const cyclic={};
  cyclic.self=cyclic;
  const badInput=await executor.execute({
    skillId:'reason',
    input:cyclic,
    decision:allow('reason','shape-1')
  });
  assert.equal(badInput.reason,SKILL_EXECUTION_REASON.INVALID_INPUT);

  const largeInput=await executor.execute({
    skillId:'reason',
    input:{text:'x'.repeat(200)},
    decision:allow('reason','shape-2')
  });
  assert.equal(largeInput.reason,SKILL_EXECUTION_REASON.INPUT_TOO_LARGE);

  const outputExecutor=createSkillExecutor({
    limits:{maxOutputBytes:64}
  });
  outputExecutor.register({
    id:'reason',
    handler:()=>({text:'y'.repeat(200)})
  });
  const largeOutput=await outputExecutor.execute({
    skillId:'reason',
    decision:allow('reason','shape-3')
  });
  assert.equal(largeOutput.status,SKILL_EXECUTION_STATUS.FAILED);
  assert.equal(largeOutput.reason,SKILL_EXECUTION_REASON.OUTPUT_TOO_LARGE);
});

test('Skill Executor times out and aborts a slow handler',async()=>{
  let observedAbort=false;
  const executor=createSkillExecutor({
    limits:{defaultTimeoutMs:20,maxTimeoutMs:100}
  });
  executor.register({
    id:'reason',
    timeoutMs:20,
    handler:async(_input,{signal})=>new Promise(resolve=>{
      signal.addEventListener('abort',()=>{
        observedAbort=true;
        resolve({late:true});
      },{once:true});
    })
  });
  const result=await executor.execute({
    skillId:'reason',
    decision:allow('reason','timeout-1')
  });
  assert.equal(result.status,SKILL_EXECUTION_STATUS.TIMEOUT);
  assert.equal(result.reason,SKILL_EXECUTION_REASON.EXECUTION_TIMEOUT);
  assert.equal(observedAbort,true);
});

test('Skill Executor defers when global concurrency limit is reached',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const executor=createSkillExecutor({
    limits:{maxConcurrent:1,defaultTimeoutMs:1000,maxTimeoutMs:1000}
  });
  executor.register({
    id:'reason',
    handler:async()=>{await gate;return {ok:true};}
  });
  executor.register({
    id:'plan',
    handler:async()=>({ok:true})
  });

  const first=executor.execute({
    skillId:'reason',
    decision:allow('reason','concurrency-1')
  });
  await new Promise(resolve=>setTimeout(resolve,0));

  const second=await executor.execute({
    skillId:'plan',
    decision:allow('plan','concurrency-2')
  });
  assert.equal(second.status,SKILL_EXECUTION_STATUS.DEFERRED);
  assert.equal(second.reason,SKILL_EXECUTION_REASON.CONCURRENCY_LIMIT);

  release();
  assert.equal((await first).status,SKILL_EXECUTION_STATUS.COMPLETED);
});

test('Skill Executor telemetry never emits input or output payload content',async()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const executor=createSkillExecutor({bus});
  executor.register({
    id:'reason',
    handler:()=>({secretOutput:'OUTPUT_DO_NOT_EMIT'})
  });
  await executor.execute({
    skillId:'reason',
    input:{secretInput:'INPUT_DO_NOT_EMIT'},
    decision:allow('reason','privacy-1'),
    requestId:'request-privacy'
  });

  const serialized=JSON.stringify(events);
  assert.equal(serialized.includes('INPUT_DO_NOT_EMIT'),false);
  assert.equal(serialized.includes('OUTPUT_DO_NOT_EMIT'),false);
  assert.match(serialized,/skill\.execution\.start/);
  assert.match(serialized,/skill\.execution\.complete/);
});

test('Skill Executor history and snapshot contain metadata only',async()=>{
  const executor=createSkillExecutor();
  executor.register({
    id:'reason',
    handler:()=>({privateValue:'NOT_IN_HISTORY'})
  });
  await executor.execute({
    skillId:'reason',
    input:{privateValue:'NOT_IN_HISTORY_EITHER'},
    decision:allow('reason','history-1')
  });
  const serialized=JSON.stringify(executor.snapshot());
  assert.equal(serialized.includes('NOT_IN_HISTORY'),false);
  assert.equal(serialized.includes('NOT_IN_HISTORY_EITHER'),false);
  assert.equal(executor.recent({limit:1})[0].status,SKILL_EXECUTION_STATUS.COMPLETED);
});


test('same skill cannot run concurrently and active skill cannot be unregistered',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const executor=createSkillExecutor({
    limits:{maxConcurrent:2,defaultTimeoutMs:1000,maxTimeoutMs:1000}
  });
  executor.register({
    id:'reason',
    handler:async()=>{await gate;return {ok:true};}
  });

  const first=executor.execute({
    skillId:'reason',
    decision:allow('reason','busy-1')
  });
  await new Promise(resolve=>setTimeout(resolve,0));

  assert.equal(executor.describe('reason').active,true);
  assert.throws(()=>executor.unregister('reason'),/active skill/);

  const second=await executor.execute({
    skillId:'reason',
    decision:allow('reason','busy-2')
  });
  assert.equal(second.status,SKILL_EXECUTION_STATUS.DEFERRED);
  assert.equal(second.reason,SKILL_EXECUTION_REASON.SKILL_BUSY);

  release();
  assert.equal((await first).status,SKILL_EXECUTION_STATUS.COMPLETED);
  assert.equal(executor.describe('reason').active,false);
});
