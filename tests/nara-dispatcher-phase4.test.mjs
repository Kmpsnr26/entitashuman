import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAutopilot,
  createCapabilityBroker,
  createExperienceModel,
  createGoalManager,
  createRecoveryEngine,
  createTaskScheduler,
  createWatchdog
} from '../nara-core/engine/index.js';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {
  AI_AUTOPILOT_STATES,
  createAIAutopilotTransaction
} from '../desktop/agent-autopilot-transaction.mjs';
import {createNaraAgentCoordinator} from '../desktop/nara-agent-coordinator.mjs';

const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};

function createAutopilotFixture(){
  const scheduler=createTaskScheduler();
  const watchdog=createWatchdog();
  const recovery=createRecoveryEngine();
  const capabilities=createCapabilityBroker();
  const experience=createExperienceModel();
  const autopilot=createAutopilot({scheduler,watchdog,recovery,capabilities,experience});
  return {autopilot,scheduler};
}

function transactionBroker(overrides={}){
  return Object.assign({
    async detect(){return {ok:true,code:'ISSUE'};},
    async reproduce(){return {ok:true,code:'REPRODUCED'};},
    async patch(){return {ok:true,code:'PATCHED'};},
    async inspect(){return {ok:true,code:'SAFE_DIFF'};},
    async test(){return {ok:true,code:'TEST_PASS'};},
    async verify(){return {ok:true,code:'VERIFY_PASS'};},
    async rollback(){return {ok:true,code:'ROLLBACK_OK'};}
  },overrides);
}

test('concurrent coordinator requests both complete instead of losing the busy request',async()=>{
  const firstStarted=deferred();
  const releaseFirst=deferred();
  const nara=createOrchestrator();
  nara.start();
  try{
    const coordinator=createNaraAgentCoordinator({
      nara,
      agentHub:{
        async run(value){
          if(value.prompt==='first request'){
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          return {text:'completed '+value.prompt};
        }
      }
    });

    const first=coordinator.run({id:'codex',prompt:'first request',mode:'analyze'});
    await firstStarted.promise;
    const second=coordinator.run({id:'codex',prompt:'second request',mode:'analyze'});
    releaseFirst.resolve();
    const results=await Promise.all([first,second]);

    assert.ok(results.every(result=>!result.error));
    assert.deepEqual(results.map(result=>result.text),[
      'completed first request',
      'completed second request'
    ]);
    assert.notEqual(results[0].nara.taskId,results[1].nara.taskId);
  }finally{
    releaseFirst.resolve();
    nara.stop();
  }
});

test('coordinator results remain correlated to their task and goal IDs',async()=>{
  const nara=createOrchestrator();
  nara.start();
  try{
    const coordinator=createNaraAgentCoordinator({
      nara,
      agentHub:{run:async value=>({text:'result for '+value.prompt})}
    });
    const results=[];
    for(const prompt of ['task alpha','task beta']){
      results.push(await coordinator.run({id:'codex',prompt,mode:'analyze'}));
    }

    assert.notEqual(results[0].nara.taskId,results[1].nara.taskId);
    assert.notEqual(results[0].nara.goalId,results[1].nara.goalId);
    const tasks=nara.snapshot().engine.autopilot.scheduler.tasks;
    for(const result of results){
      const task=tasks.find(item=>item.id===result.nara.taskId);
      assert.ok(task);
      assert.equal(task.goalId,result.nara.goalId);
      assert.equal(task.status,'complete');
    }
  }finally{
    nara.stop();
  }
});

test('capability-blocked high-priority work does not starve runnable tasks',async()=>{
  const {autopilot,scheduler}=createAutopilotFixture();
  const calls=[];
  autopilot.registerHandler('system.protected',async()=>{calls.push('protected');return {ok:true};},{
    capability:'os.privileged.action'
  });
  autopilot.registerHandler('safe.read',async()=>{calls.push('safe');return {ok:true};});
  autopilot.enqueue({id:'protected-task',handler:'system.protected',priority:100});
  autopilot.enqueue({id:'safe-task',handler:'safe.read',priority:50});

  const result=await autopilot.runNext();

  assert.equal(result.ok,true);
  assert.equal(result.task.id,'safe-task');
  assert.deepEqual(calls,['safe']);
  assert.equal(scheduler.get('protected-task').status,'queued');
  assert.equal(scheduler.get('safe-task').status,'complete');
});

test('autopilot timeout and cancellation abort work and roll back partial changes',async()=>{
  const broker=transactionBroker({
    async patch(){
      await new Promise(resolve=>setTimeout(resolve,20));
      return {ok:true,code:'PATCHED'};
    }
  });
  const auto=createAIAutopilotTransaction({broker,limits:{maxAttempts:1}});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5);
  let result;
  try{
    result=await auto.runOnce({requestId:'phase4-timeout',signal:controller.signal});
  }finally{
    clearTimeout(timeout);
  }

  assert.equal(result.status,AI_AUTOPILOT_STATES.ROLLED_BACK);
  assert.equal(result.reason,'ABORTED');
  assert.deepEqual(result.steps.map(step=>step.name),[
    'detect','reproduce','patch','rollback'
  ]);
  assert.equal(result.steps[result.steps.length-1].ok,true);

  const cancelled=new AbortController();
  cancelled.abort();
  const calls=[];
  const preCancelled=createAIAutopilotTransaction({
    broker:transactionBroker({
      async detect(){calls.push('detect');return {ok:true,code:'ISSUE'};}
    }),
    limits:{maxAttempts:1}
  });
  const cancelledResult=await preCancelled.runOnce({signal:cancelled.signal});
  assert.equal(cancelledResult.reason,'ABORTED');
  assert.deepEqual(calls,[]);
});

test('goal success criteria are recorded and unmet work does not complete the goal',async()=>{
  const nara=createOrchestrator();
  nara.start();
  try{
    const coordinator=createNaraAgentCoordinator({
      nara,
      agentHub:{
        async run(value){
          return value.prompt==='Apply the required change'
            ?{
              id:value.id,
              mode:value.mode,
              text:'No files changed',
              maintenance:{changedFiles:0}
            }
            :{id:value.id,mode:value.mode,text:'Verified'};
        }
      }
    });
    const verified=await coordinator.run({
      id:'codex',
      prompt:'Verify goal success',
      mode:'analyze'
    });
    const verifiedGoal=nara.snapshot().engine.goals.goals.find(item=>item.id===verified.nara.goalId);
    assert.equal(verifiedGoal.status,'complete');
    assert.deepEqual(verifiedGoal.successCriteria,[
      'Agent Hub menyelesaikan task',
      'Hasil melewati lifecycle verifikasi NARA'
    ]);

    const result=await coordinator.run({
      id:'codex',
      prompt:'Apply the required change',
      mode:'work'
    });
    const goal=nara.snapshot().engine.goals.goals.find(item=>item.id===result.nara.goalId);

    assert.deepEqual(goal.successCriteria,[
      'Agent Hub menyelesaikan task',
      'Hasil melewati lifecycle verifikasi NARA'
    ]);
    assert.match(result.error,/belum menghasilkan perubahan berkas/);
    assert.equal(result.nara.goalStatus,'blocked');
    assert.notEqual(goal.status,'complete');
  }finally{
    nara.stop();
  }
});

test('autopilot retry reuses its request ID and rolls back before retrying',async()=>{
  const calls=[];
  let patchAttempts=0;
  const broker=transactionBroker({
    async detect({transactionId}){calls.push(['detect',transactionId]);return {ok:true,code:'ISSUE'};},
    async reproduce({transactionId,attempt}){
      calls.push(['reproduce',transactionId,attempt]);
      return {ok:true,code:'REPRODUCED'};
    },
    async patch({transactionId,attempt}){
      calls.push(['patch',transactionId,attempt]);
      patchAttempts++;
      return patchAttempts===1
        ?{ok:false,code:'PATCH_FAILED'}
        :{ok:true,code:'PATCHED'};
    },
    async rollback({transactionId,attempt}){
      calls.push(['rollback',transactionId,attempt]);
      return {ok:true,code:'ROLLBACK_OK'};
    },
    async inspect({transactionId,attempt}){
      calls.push(['inspect',transactionId,attempt]);
      return {ok:true,code:'SAFE_DIFF'};
    },
    async test({transactionId,attempt}){
      calls.push(['test',transactionId,attempt]);
      return {ok:true,code:'TEST_PASS'};
    },
    async verify({transactionId,attempt}){
      calls.push(['verify',transactionId,attempt]);
      return {ok:true,code:'VERIFY_PASS'};
    }
  });
  const auto=createAIAutopilotTransaction({broker,limits:{maxAttempts:2}});
  const result=await auto.runOnce({requestId:'phase4-idempotent-retry'});

  assert.equal(result.status,AI_AUTOPILOT_STATES.PASSED);
  assert.equal(result.transactionId,'phase4-idempotent-retry');
  assert.ok(calls.every(call=>call[1]==='phase4-idempotent-retry'));
  const rollbackIndex=calls.findIndex(call=>call[0]==='rollback');
  const retryIndex=calls.findIndex(call=>call[0]==='reproduce'&&call[2]===2);
  assert.ok(rollbackIndex>=0);
  assert.ok(retryIndex>rollbackIndex);
  assert.deepEqual(calls.filter(call=>call[0]==='rollback').map(call=>call[2]),[1]);
});


test('NARA Core dispatcher serializes concurrent task waiters and preserves each result',async()=>{
  const {autopilot,scheduler}=createAutopilotFixture();
  const firstStarted=deferred(),releaseFirst=deferred();
  autopilot.registerHandler('test.concurrent',async({task})=>{
    if(task.id==='concurrent-a'){firstStarted.resolve();await releaseFirst.promise;}
    return {taskId:task.id};
  });
  autopilot.enqueue({id:'concurrent-a',handler:'test.concurrent',priority:90});
  autopilot.enqueue({id:'concurrent-b',handler:'test.concurrent',priority:80});
  const first=autopilot.runTask('concurrent-a');
  await firstStarted.promise;
  const second=autopilot.runTask('concurrent-b');
  releaseFirst.resolve();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.equal(a.result.taskId,'concurrent-a');assert.equal(b.result.taskId,'concurrent-b');
  assert.equal(scheduler.get('concurrent-a').status,'complete');
  assert.equal(scheduler.get('concurrent-b').status,'complete');
});

test('NARA Core timeout aborts the handler and releases dispatcher capacity',async()=>{
  const {autopilot,scheduler}=createAutopilotFixture();
  let signalSeen=false;
  autopilot.registerHandler('test.timeout',async({signal})=>new Promise((resolve)=>{
    signal.addEventListener('abort',()=>{signalSeen=true;resolve('aborted');},{once:true});
  }),{timeoutMs:1000});
  autopilot.registerHandler('test.after-timeout',async()=>({ok:true}));
  autopilot.enqueue({id:'timeout-task',handler:'test.timeout'});
  autopilot.enqueue({id:'after-timeout-task',handler:'test.after-timeout'});
  const result=await autopilot.runTask('timeout-task');
  assert.equal(result.ok,false);
  assert.equal(result.error,'Autopilot task timeout.');
  assert.equal(signalSeen,true);
  assert.equal(scheduler.get('timeout-task').status,'failed');
  assert.equal(scheduler.snapshot().running,0);
  const next=await autopilot.runTask('after-timeout-task');
  assert.equal(next.ok,true);
});

test('NARA Core GoalManager rejects completion without verified evidence',()=>{
  const goals=createGoalManager();
  goals.create({id:'evidence-goal',successCriteria:['deliverable exists','verification passed']});
  goals.activate('evidence-goal');
  goals.attachTask('evidence-goal','evidence-task');
  assert.throws(()=>goals.complete('evidence-goal'),/task terkait|bukti terverifikasi/);
  goals.recordEvidence('evidence-goal',{criterion:'deliverable exists',evidence:'artifact-123',verified:true});
  assert.throws(()=>goals.complete('evidence-goal'),/bukti terverifikasi/);
  goals.recordEvidence('evidence-goal',{criterion:'verification passed',evidence:'test-run-456',verified:true});
  assert.throws(()=>goals.complete('evidence-goal'),/seluruh task terkait harus selesai/);
  goals.reconcileTasks([{id:'evidence-task',status:'complete'}]);
  assert.equal(goals.complete('evidence-goal').status,'complete');
});

test('NARA Core recovery refuses retry without idempotency or confirmed compensation',()=>{
  const recovery=createRecoveryEngine({maxRetries:2});
  assert.equal(recovery.decide({attempt:1,errorCategory:'runtime'}).action,'escalate');
  assert.equal(recovery.decide({attempt:1,errorCategory:'runtime'}).reason,
    'unsafe-retry-requires-idempotency-or-confirmed-compensation');
  assert.equal(recovery.decide({attempt:1,errorCategory:'runtime',idempotent:true}).action,'retry');
  assert.equal(recovery.decide({attempt:1,errorCategory:'runtime',compensationConfirmed:true}).action,'retry');
});


test('NARA Core cancellation aborts only the targeted running handler',async()=>{
  const {autopilot,scheduler}=createAutopilotFixture();
  const started=deferred();
  let abortObserved=false;
  autopilot.registerHandler('test.cancel',async({signal,task})=>new Promise((resolve)=>{
    started.resolve(task.id);
    signal.addEventListener('abort',()=>{abortObserved=true;resolve('cancelled');},{once:true});
  }));
  autopilot.enqueue({id:'cancel-target',handler:'test.cancel'});
  const pending=autopilot.runTask('cancel-target');
  await started.promise;
  const cancelled=autopilot.cancel('cancel-target','test cancellation');
  const result=await pending;
  assert.equal(cancelled.status,'cancelled');
  assert.equal(result.ok,false);
  assert.equal(scheduler.get('cancel-target').status,'cancelled');
  assert.equal(abortObserved,true);
  assert.equal(scheduler.snapshot().running,0);
});


test('Coordinator forwards NARA cancellation to the Agent Hub executor',async()=>{
  const nara=createOrchestrator();nara.start();
  const started=deferred();let receivedSignal=null;
  try{
    const coordinator=createNaraAgentCoordinator({
      nara,
      agentHub:{run({signal}){
        receivedSignal=signal;
        return new Promise((resolve,reject)=>{
          signal.addEventListener('abort',()=>reject(new Error('Agent Hub aborted by NARA')), {once:true});
          started.resolve(signal);
        });
      }}
    });
    const pending=coordinator.run({id:'codex',prompt:'cancel this task',mode:'analyze'});
    const signal=await started.promise;
    const running=nara.snapshot().engine.autopilot.scheduler.tasks.find(task=>task.status==='running');
    assert.ok(running);
    nara.autopilot.cancel(running.id,'test cancellation');
    const result=await pending;
    assert.equal(receivedSignal,signal);
    assert.equal(signal.aborted,true);
    assert.match(result.error,/Agent Hub aborted by NARA|test cancellation/);
  }finally{nara.stop();}
});


test('NARA Core does not wait forever for an orphaned running task',async()=>{
  const {autopilot,scheduler}=createAutopilotFixture();
  autopilot.registerHandler('test.orphan',async()=>({ok:true}));
  scheduler.enqueue({id:'orphan-running',handler:'test.orphan'});
  scheduler.start('orphan-running');
  const result=await autopilot.runTask('orphan-running');
  assert.equal(result.ok,false);
  assert.equal(result.reason,'task-already-running');
});


test('Coordinator work Goal requires an independent reviewer PASS',async()=>{
  const nara=createOrchestrator();nara.start();
  try{
    const coordinator=createNaraAgentCoordinator({
      nara,
      agentHub:{async run(value){
        return {
          text:'Work output for '+value.prompt,
          maintenance:{changedFiles:1},
          verification:value.prompt.includes('stale-pass')?{status:'passed'}:undefined,
          stages:value.prompt.includes('stale-pass')
            ?[{role:'reviewer',text:'VERDICT: PASS'},{role:'reviewer',text:'VERDICT: NEEDS_FIX'}]
            :value.prompt.includes('review-pass')
              ?[{role:'reviewer',text:'Review complete. VERDICT: PASS'}]
              :[]
        };
      }}
    });
    const rejected=await coordinator.run({id:'codex',prompt:'work without reviewer',mode:'work'});
    assert.match(rejected.error,/reviewer independen/);
    assert.equal(rejected.nara.goalStatus,'blocked');
    const accepted=await coordinator.run({id:'codex',prompt:'work with review-pass',mode:'work'});
    assert.equal(accepted.nara.goalStatus,'complete');
    const stale=await coordinator.run({id:'codex',prompt:'work with stale-pass',mode:'work'});
    assert.match(stale.error,/reviewer independen/);
    assert.equal(stale.nara.goalStatus,'blocked');
  }finally{nara.stop();}
});
