import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NARA_UNIFIED_COMPONENTS,
  NARA_UNIFIED_SIMULATION_MODE,
  createNaraUnifiedSimulationStack
} from '../nara-core/simulation/index.js';
import {READINESS_STATUS} from '../nara-core/readiness/index.js';

function makeStack(){
  let sequence=0;
  let clock=1000;
  return createNaraUnifiedSimulationStack({
    now:()=>++clock,
    idFactory:()=> 'sim-'+(++sequence)
  });
}

test('unified simulation stack composes every real NARA component and exposes no real transport switch',()=>{
  const stack=makeStack();
  const snapshot=stack.snapshot();

  assert.equal(stack.mode,NARA_UNIFIED_SIMULATION_MODE);
  assert.equal(snapshot.mode,'SIMULATION_ONLY');
  assert.equal(snapshot.mockHumanALE,true);
  assert.equal(snapshot.realHumanALEBridgeActive,false);
  assert.equal(snapshot.finalIntegrationUnlocked,false);
  assert.equal(snapshot.readiness.status,READINESS_STATUS.SIMULATION_READY);
  assert.equal(snapshot.readiness.simulationReady,true);
  assert.equal(snapshot.readiness.liveReady,false);
  assert.ok(snapshot.readiness.liveMissing.includes('humanale.creator_final_approval'));
  assert.deepEqual(
    snapshot.components.map(item=>item.id).sort(),
    [...NARA_UNIFIED_COMPONENTS].sort()
  );
  assert.ok(snapshot.components.every(item=>item.status==='healthy'));
  assert.ok(snapshot.components.every(item=>item.circuit==='CLOSED'));

  assert.equal(typeof stack.setTransport,'undefined');
  assert.equal(typeof stack.activateRealIntegration,'undefined');
  assert.equal(typeof stack.unlock,'undefined');
});

test('real Decision Memory Executor Verification Learning and Workflow engines complete one bounded path',async()=>{
  const stack=makeStack();
  const report=await stack.runReasonSimulation({
    workflowId:'wf-unified-reason',
    requestId:'req-unified-reason',
    input:{privateValue:'DO_NOT_RETAIN_UNIFIED_INPUT'}
  });

  assert.equal(report.status,'COMPLETED');
  assert.equal(report.decision.outcome,'ALLOW');
  assert.equal(report.execution.status,'COMPLETED');
  assert.equal(report.verification.verdict,'PASS');
  assert.equal(report.learning.executionRecorded,true);
  assert.equal(report.learning.verificationRecorded,true);

  const snapshot=stack.snapshot();
  assert.ok(snapshot.counters.decision.allowed>=1);
  assert.ok(snapshot.counters.memory.contextPrepared>=1);
  assert.ok(snapshot.counters.execution.completed>=1);
  assert.ok(snapshot.counters.verification.passed>=1);
  assert.ok(snapshot.counters.learning.signals>=2);
  assert.ok(snapshot.counters.workflow.completed>=1);

  const serialized=JSON.stringify({report,snapshot});
  assert.equal(serialized.includes('DO_NOT_RETAIN_UNIFIED_INPUT'),false);
  assert.match(serialized,/decision\.completed/);
  assert.match(serialized,/skill\.execution\.complete/);
  assert.match(serialized,/verification\.complete/);
  assert.match(serialized,/learning\.signal\.recorded/);
  assert.match(serialized,/workflow\.complete/);
});

test('exact scoped owner approval gates a single mock HumanALE delivery and cannot be reused',async()=>{
  const stack=makeStack();
  stack.createMockCommandApproval({
    id:'approval-mock-1',
    scope:'session.sim-1'
  });

  const pending=await stack.runMockHumanALESimulation({
    approvalId:'approval-mock-1',
    scope:'session.sim-1',
    workflowId:'wf-mock-pending'
  });
  assert.equal(pending.status,'APPROVAL_REQUIRED');
  assert.equal(stack.snapshot().mockHumanALEState.received,0);

  stack.decideMockCommandApproval('approval-mock-1',{
    approved:true,
    authority:'owner'
  });

  const wrongScope=await stack.runMockHumanALESimulation({
    approvalId:'approval-mock-1',
    scope:'session.sim-2',
    workflowId:'wf-mock-wrong-scope'
  });
  assert.equal(wrongScope.status,'APPROVAL_REQUIRED');
  assert.equal(wrongScope.reason,'scope_mismatch');
  assert.equal(stack.snapshot().mockHumanALEState.received,0);

  const complete=await stack.runMockHumanALESimulation({
    approvalId:'approval-mock-1',
    scope:'session.sim-1',
    workflowId:'wf-mock-complete',
    requestId:'req-mock-complete'
  });
  assert.equal(complete.status,'COMPLETED');
  assert.equal(complete.decision.outcome,'ALLOW');
  assert.equal(complete.verification.verdict,'PASS');

  const after=stack.snapshot();
  assert.equal(after.mockHumanALEState.received,1);
  assert.equal(after.counters.integration.delivered,1);
  assert.equal(after.approvalStatusCounts.CONSUMED,1);

  const reused=await stack.runMockHumanALESimulation({
    approvalId:'approval-mock-1',
    scope:'session.sim-1',
    workflowId:'wf-mock-reuse'
  });
  assert.equal(reused.status,'APPROVAL_REQUIRED');
  assert.equal(reused.reason,'approval_consumed');
  assert.equal(stack.snapshot().mockHumanALEState.received,1);
});

test('Supervisor opens the circuit and blocks the unified stack before execution',async()=>{
  const stack=makeStack();
  stack.reportComponentHealth({
    componentId:'execution',
    status:'error',
    errorCode:'simulation_fault'
  });

  const recommendation=stack.recoveryRecommendation('execution');
  assert.equal(recommendation.status,'review_required');
  assert.equal(recommendation.requiresApproval,true);
  assert.equal(recommendation.autoExecute,false);

  const report=await stack.runReasonSimulation({
    workflowId:'wf-supervisor-block',
    input:{value:1}
  });
  assert.equal(report.status,'BLOCKED');
  assert.match(report.reason,/SUPERVISOR_EXECUTION_/);

  const snapshot=stack.snapshot();
  assert.equal(snapshot.counters.execution.attempts,0);
  assert.equal(snapshot.counters.workflow.attempts,0);
  assert.equal(
    snapshot.components.find(item=>item.id==='execution').circuit,
    'OPEN'
  );
});

test('real HumanALE integration handshake remains fail-closed while FINAL_READY is false',()=>{
  const stack=makeStack();
  const boundary=stack.evaluateFinalIntegrationBoundary({
    id:'integration-boundary-test'
  });

  assert.equal(boundary.outcome,'DEFER');
  assert.deepEqual(boundary.missingGates,['humanale.final_ready']);
  assert.equal(boundary.capability,'sync');

  const snapshot=stack.snapshot();
  assert.equal(snapshot.realHumanALEBridgeActive,false);
  assert.equal(snapshot.finalIntegrationUnlocked,false);
  assert.equal(snapshot.integration.connectedToMock,true);
  assert.equal(snapshot.mockHumanALE,true);
});


test('readiness failure blocks unified simulation before workflow execution',async()=>{
  const stack=makeStack();
  const readiness=stack.setReadinessFacts({'security.codeql_pass':false});
  assert.equal(readiness.status,READINESS_STATUS.NOT_READY);
  assert.equal(readiness.simulationReady,false);

  const report=await stack.runReasonSimulation({
    workflowId:'wf-readiness-block'
  });
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.reason,'SIMULATION_READINESS_INCOMPLETE');
  assert.equal(stack.snapshot().counters.workflow.attempts,0);
});

test('unknown readiness facts fail closed',()=>{
  const stack=makeStack();
  assert.throws(
    ()=>stack.setReadinessFacts({'bypass.everything':true}),
    /Unknown readiness gate/
  );
});

test('even LIVE_READY facts cannot activate a real HumanALE transport',()=>{
  const stack=makeStack();
  const readiness=stack.setReadinessFacts({
    'humanale.real_test_pass':true,
    'humanale.final_ready':true,
    'humanale.baseline_frozen':true,
    'humanale.creator_final_approval':true
  });
  assert.equal(readiness.status,READINESS_STATUS.LIVE_READY);
  assert.equal(readiness.liveReady,true);

  const boundary=stack.evaluateFinalIntegrationBoundary({
    id:'live-ready-still-no-activation'
  });
  assert.equal(boundary.outcome,'DEFER');

  const snapshot=stack.snapshot();
  assert.equal(snapshot.realHumanALEBridgeActive,false);
  assert.equal(snapshot.finalIntegrationUnlocked,false);
  assert.equal(typeof stack.setTransport,'undefined');
  assert.equal(typeof stack.activateRealIntegration,'undefined');
});
