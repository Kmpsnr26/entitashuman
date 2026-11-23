import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../alecore-ai/brain/event-bus.js';
import {
  WORKFLOW_STATUS,
  WORKFLOW_REASONS,
  createWorkflowOrchestrator
} from '../alecore-ai/workflow/index.js';

function components(overrides={}){
  const calls=[];
  const decisionEngine={
    decide(request){
      calls.push(['decision',request.action]);
      return {id:request.id,outcome:'ALLOW',risk:'low',capability:'reason',reasonCodes:['POLICY_ALLOW']};
    }
  };
  const memoryManager={
    prepareContext(request){
      calls.push(['memory.prepare',request.target]);
      return {id:'ctx-1',target:request.target||'reasoner',totalBytes:10,sensitiveBlocked:0,items:[{id:'m1',value:{x:1}}]};
    },
    useContext(id){calls.push(['memory.use',id]);return {id};}
  };
  const skillExecutor={
    async execute({skillId,input}){
      calls.push(['execute',skillId,input.context?.id||null]);
      return {executionId:'exec-1',skillId,status:'COMPLETED',reason:null,durationMs:5,endedAt:100,output:{answer:42}};
    }
  };
  const verificationEngine={
    async verify({execution,artifact,verifierIds}){
      calls.push(['verify',execution.executionId,artifact.answer,verifierIds.length]);
      return {verificationId:'verify-1',skillId:execution.skillId,verdict:'PASS',reason:null,durationMs:2,endedAt:110,checks:[{ok:true}]};
    },
    toLearningSignal(report){
      calls.push(['verification.signal',report.verdict]);
      return {id:'learn-verify-1',kind:'verification',skillId:report.skillId,outcome:'success',authority:'verifier',timestamp:report.endedAt,weight:1,tags:['verification']};
    }
  };
  const learningEngine={
    observeExecution(execution){calls.push(['learn.execution',execution.status]);return {accepted:true};},
    ingest(signal){calls.push(['learn.verify',signal.outcome]);return {accepted:true};}
  };
  return {
    calls,
    decisionEngine,
    memoryManager,
    skillExecutor,
    verificationEngine,
    learningEngine,
    ...overrides
  };
}

test('workflow executes Decision -> Memory -> Skill -> Verification -> Learning in order',async()=>{
  const c=components();
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-1',
    requestId:'req-1',
    decisionRequest:{action:'skill.execute',capability:'reason'},
    decisionContext:{},
    contextRequest:{target:'reasoner',tags:['task']},
    skillId:'reason',
    input:{question:'PRIVATE_INPUT'},
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.COMPLETED);
  assert.deepEqual(c.calls.map(item=>item[0]),[
    'decision',
    'memory.prepare',
    'memory.use',
    'execute',
    'learn.execution',
    'verify',
    'verification.signal',
    'learn.verify'
  ]);
  assert.equal(JSON.stringify(report).includes('PRIVATE_INPUT'),false);
  assert.equal(JSON.stringify(report).includes('"answer":42'),false);
  assert.equal(JSON.stringify(report).includes('"x":1'),false);
});

test('decision BLOCK stops before memory or execution',async()=>{
  const c=components({
    decisionEngine:{
      decide(){c.calls.push(['decision']);return {id:'d',outcome:'BLOCK',capability:'reason',reasonCodes:['DENIED']};}
    }
  });
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-block',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.BLOCKED);
  assert.equal(report.reason,WORKFLOW_REASONS.DECISION_BLOCKED);
  assert.deepEqual(c.calls.map(item=>item[0]),['decision']);
});

test('approval and defer decisions stop without side effects',async()=>{
  for(const [outcome,status,reason] of [
    ['REQUIRE_APPROVAL',WORKFLOW_STATUS.APPROVAL_REQUIRED,WORKFLOW_REASONS.DECISION_APPROVAL_REQUIRED],
    ['DEFER',WORKFLOW_STATUS.DEFERRED,WORKFLOW_REASONS.DECISION_DEFERRED]
  ]){
    const c=components({
      decisionEngine:{decide(){return {id:'d',outcome,capability:'reason',reasonCodes:[]};}}
    });
    const workflow=createWorkflowOrchestrator(c);
    const report=await workflow.run({
      workflowId:'wf-'+outcome.toLowerCase(),
      decisionRequest:{action:'skill.execute'},
      skillId:'reason',
      verifierIds:['shape']
    });
    assert.equal(report.status,status);
    assert.equal(report.reason,reason);
  }
});

test('ALLOW decision capability must exactly match skill ID',async()=>{
  const c=components({
    decisionEngine:{decide(){return {id:'d',outcome:'ALLOW',capability:'plan',reasonCodes:['POLICY_ALLOW']};}}
  });
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-mismatch',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.BLOCKED);
  assert.equal(report.reason,WORKFLOW_REASONS.DECISION_CAPABILITY_MISMATCH);
});

test('generic workflow blocks sensitive context before decision or memory access',async()=>{
  const c=components();
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-sensitive',
    decisionRequest:{action:'skill.execute'},
    contextRequest:{target:'reasoner',includeSensitive:true},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.BLOCKED);
  assert.equal(report.reason,WORKFLOW_REASONS.SENSITIVE_CONTEXT_REQUIRES_SEPARATE_APPROVAL_FLOW);
  assert.equal(c.calls.length,0);
});

test('execution failure stops before verification but still records execution learning metadata',async()=>{
  const c=components();
  c.skillExecutor={
    async execute({skillId}){
      c.calls.push(['execute',skillId]);
      return {executionId:'exec-fail',skillId,status:'FAILED',reason:'HANDLER_ERROR',durationMs:5,endedAt:100,output:null};
    }
  };
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-exec-fail',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.EXECUTION_FAILED);
  assert.equal(report.learning.executionRecorded,true);
  assert.equal(c.calls.some(item=>item[0]==='verify'),false);
});

test('completed execution requires at least one verifier',async()=>{
  const c=components();
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-no-verify',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:[]
  });
  assert.equal(report.status,WORKFLOW_STATUS.VERIFICATION_ERROR);
  assert.equal(report.reason,WORKFLOW_REASONS.VERIFICATION_REQUIRED);
});

test('verification FAIL becomes workflow failure and records learning evidence',async()=>{
  const c=components();
  c.verificationEngine={
    async verify({execution}){
      c.calls.push(['verify',execution.executionId]);
      return {verificationId:'verify-fail',skillId:execution.skillId,verdict:'FAIL',reason:'CHECK_FAILED',durationMs:2,endedAt:110,checks:[{ok:false}]};
    },
    toLearningSignal(report){
      c.calls.push(['verification.signal',report.verdict]);
      return {id:'learn-fail',kind:'verification',skillId:report.skillId,outcome:'failure',authority:'verifier',timestamp:110,weight:1,tags:['verification']};
    }
  };
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-verify-fail',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.VERIFICATION_FAILED);
  assert.equal(report.reason,WORKFLOW_REASONS.VERIFICATION_FAILED);
  assert.equal(report.learning.verificationRecorded,true);
});

test('learning failure is observational and does not change PASS workflow result',async()=>{
  const c=components();
  c.learningEngine={
    observeExecution(){throw new Error('learning unavailable');},
    ingest(){throw new Error('learning unavailable');}
  };
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-learning-down',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.COMPLETED);
  assert.equal(report.learning.executionRecorded,false);
  assert.equal(report.learning.verificationRecorded,false);
});

test('workflow history and Event Bus retain metadata only',async()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const c=components({bus});
  const workflow=createWorkflowOrchestrator(c);
  await workflow.run({
    workflowId:'wf-privacy',
    requestId:'req-privacy',
    decisionRequest:{action:'skill.execute'},
    contextRequest:{target:'reasoner'},
    skillId:'reason',
    input:{secret:'INPUT_NOT_RETAINED'},
    verifierIds:['shape']
  });
  const serialized=JSON.stringify({snapshot:workflow.snapshot(),events});
  assert.equal(serialized.includes('INPUT_NOT_RETAINED'),false);
  assert.equal(serialized.includes('"answer":42'),false);
  assert.equal(serialized.includes('"x":1'),false);
  assert.match(serialized,/workflow\.start/);
  assert.match(serialized,/workflow\.complete/);
});

test('completed workflow IDs are idempotent while retained',async()=>{
  let executions=0;
  const c=components();
  c.skillExecutor={
    async execute({skillId}){
      executions++;
      return {executionId:'exec-idem',skillId,status:'COMPLETED',durationMs:1,endedAt:1,output:{answer:42}};
    }
  };
  const workflow=createWorkflowOrchestrator(c);
  const args={
    workflowId:'wf-idem',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  };
  const first=await workflow.run(args);
  const second=await workflow.run(args);
  assert.equal(first.status,WORKFLOW_STATUS.COMPLETED);
  assert.equal(second.duplicate,true);
  assert.equal(executions,1);
});

test('global workflow concurrency is bounded',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const c=components();
  c.skillExecutor={
    async execute({skillId}){
      c.calls.push(['execute',skillId]);
      await gate;
      return {executionId:'exec-held',skillId,status:'COMPLETED',durationMs:1,endedAt:1,output:{answer:42}};
    }
  };
  const workflow=createWorkflowOrchestrator({...c,limits:{maxConcurrent:1}});
  const first=workflow.run({
    workflowId:'wf-concurrent-1',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await workflow.run({
    workflowId:'wf-concurrent-2',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    verifierIds:['shape']
  });
  assert.equal(second.status,WORKFLOW_STATUS.DEFERRED);
  assert.equal(second.reason,WORKFLOW_REASONS.CONCURRENCY_LIMIT);
  release();
  await first;
});


test('workflow never passes execution output into Learning Engine metadata adapter',async()=>{
  let learnedExecution=null;
  let verificationExecution=null;
  const c=components();
  c.learningEngine={
    observeExecution(execution){learnedExecution=execution;return {accepted:true};},
    ingest(){return {accepted:true};}
  };
  c.verificationEngine={
    async verify({execution,artifact}){
      verificationExecution=execution;
      assert.deepEqual(artifact,{answer:42});
      return {verificationId:'verify-narrow',skillId:execution.skillId,verdict:'PASS',reason:null,durationMs:1,endedAt:2,checks:[{ok:true}]};
    },
    toLearningSignal(report){
      return {id:'learn-narrow',kind:'verification',skillId:report.skillId,outcome:'success',authority:'verifier',timestamp:2,weight:1,tags:['verification']};
    }
  };
  const workflow=createWorkflowOrchestrator(c);
  const report=await workflow.run({
    workflowId:'wf-narrow-handoff',
    decisionRequest:{action:'skill.execute'},
    skillId:'reason',
    input:{private:'INPUT_PRIVATE'},
    verifierIds:['shape']
  });
  assert.equal(report.status,WORKFLOW_STATUS.COMPLETED);
  assert.equal(Object.hasOwn(learnedExecution,'output'),false);
  assert.equal(Object.hasOwn(verificationExecution,'output'),false);
  assert.equal(JSON.stringify(learnedExecution).includes('42'),false);
});
