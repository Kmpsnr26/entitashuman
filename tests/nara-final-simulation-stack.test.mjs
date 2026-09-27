import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READINESS_STATUS
} from '../nara-core/readiness/index.js';
import {
  FINAL_SIMULATION_CAPABILITY,
  FINAL_SIMULATION_SCOPE,
  createFinalSimulationStack,
  finalSimulationReadinessFacts
} from '../nara-core/simulation/index.js';

function approvedStack(){
  let now=1000;
  const stack=createFinalSimulationStack({
    now:()=>++now,
    readinessFacts:finalSimulationReadinessFacts()
  });
  stack.seedMemory({
    id:'simulation-memory',
    value:{stage:'final-simulation'},
    tags:['simulation']
  });
  stack.reportHealthy({latencyMs:1,timestamp:1010});
  stack.requestApproval({
    id:'simulation-approval',
    requestedBy:'operator',
    ttlMs:10000
  });
  stack.approvalManager.decide('simulation-approval',{
    approved:true,
    authority:'owner',
    timestamp:1011
  });
  return stack;
}

test('combined final stack completes end-to-end with Mock HumanALE only',async()=>{
  const stack=approvedStack();
  const report=await stack.run({
    approvalId:'simulation-approval',
    requestId:'simulation-request-1',
    workflowId:'simulation-workflow-1',
    input:{private:'DO_NOT_RETAIN'}
  });

  assert.equal(report.status,'SIMULATION_PASS');
  assert.equal(report.mode,'MOCK_HUMANALE_ONLY');
  assert.equal(report.liveHumanALE,false);
  assert.equal(report.readiness.status,READINESS_STATUS.SIMULATION_READY);
  assert.equal(report.readiness.simulationReady,true);
  assert.equal(report.readiness.liveReady,false);
  assert.deepEqual(report.readiness.liveMissing.filter(x=>x.startsWith('humanale.')),[
    'humanale.real_test_pass',
    'humanale.final_ready',
    'humanale.baseline_frozen'
  ]);
  assert.equal(report.workflow.status,'COMPLETED');
  assert.equal(report.mockHandshake.liveTransport,false);
  assert.equal(report.mockHandshake.bridgeHealth,'READY');
  assert.equal(report.mockHandshake.mockHealth,'READY');
  assert.equal(report.learning.reliability,1);
  assert.equal(JSON.stringify(report).includes('DO_NOT_RETAIN'),false);
});

test('simulation approval is exact scoped and single-use',async()=>{
  const stack=approvedStack();
  const approval=stack.approvalManager.get('simulation-approval',{timestamp:1012});
  assert.equal(approval.capability,FINAL_SIMULATION_CAPABILITY);
  assert.equal(approval.scope,FINAL_SIMULATION_SCOPE);

  const first=await stack.run({
    approvalId:'simulation-approval',
    workflowId:'simulation-workflow-a'
  });
  assert.equal(first.status,'SIMULATION_PASS');

  const second=await stack.run({
    approvalId:'simulation-approval',
    workflowId:'simulation-workflow-b'
  });
  assert.equal(second.status,'BLOCKED');
  assert.equal(second.reason,'SIMULATION_APPROVAL_REQUIRED');
});

test('missing owner approval blocks before workflow and mock bridge activity',async()=>{
  let now=2000;
  const stack=createFinalSimulationStack({
    now:()=>++now,
    readinessFacts:finalSimulationReadinessFacts()
  });
  stack.reportHealthy({timestamp:2001});
  stack.requestApproval({id:'pending-approval'});

  const report=await stack.run({
    approvalId:'pending-approval',
    workflowId:'blocked-workflow'
  });
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.reason,'SIMULATION_APPROVAL_REQUIRED');
  assert.equal(stack.workflow.snapshot().counters.attempts,0);
  assert.equal(stack.mockHumanALE.snapshot().received.length,0);
});

test('incomplete NARA readiness blocks before workflow even with owner approval',async()=>{
  let now=3000;
  const facts={
    ...finalSimulationReadinessFacts(),
    'nara.verification.validated':false
  };
  const stack=createFinalSimulationStack({
    now:()=>++now,
    readinessFacts:facts
  });
  stack.reportHealthy({timestamp:3001});
  stack.requestApproval({id:'readiness-approval'});
  stack.approvalManager.decide('readiness-approval',{
    approved:true,
    authority:'owner',
    timestamp:3002
  });

  const report=await stack.run({
    approvalId:'readiness-approval',
    workflowId:'readiness-blocked'
  });
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.reason,'SIMULATION_READINESS_INCOMPLETE');
  assert.equal(report.readiness.simulationReady,false);
  assert.equal(stack.workflow.snapshot().counters.attempts,0);
});

test('unhealthy supervisor component blocks execution',async()=>{
  const stack=approvedStack();
  stack.supervisor.report({
    componentId:'verification',
    status:'error',
    errorCode:'verification_unhealthy',
    timestamp:1012
  });

  const report=await stack.run({
    approvalId:'simulation-approval',
    workflowId:'supervisor-blocked'
  });
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.reason,'SUPERVISOR_GATE_BLOCKED');
  assert.ok(report.unhealthy.some(item=>item.componentId==='verification'));
  assert.equal(stack.workflow.snapshot().counters.attempts,0);
});

test('simulation branch exposes Mock HumanALE and no live transport installer',()=>{
  const stack=createFinalSimulationStack({
    readinessFacts:finalSimulationReadinessFacts()
  });
  assert.equal(stack.mode,'MOCK_HUMANALE_ONLY');
  assert.equal(typeof stack.installLiveTransport,'undefined');
  assert.equal(typeof stack.connectLiveHumanALE,'undefined');
  assert.equal(typeof stack.activateHumanALE,'undefined');
});

test('even fully-final HumanALE facts do not change this branch from mock-only mode',async()=>{
  let now=4000;
  const stack=createFinalSimulationStack({
    now:()=>++now,
    readinessFacts:finalSimulationReadinessFacts({
      humanaleRealTestPass:true,
      humanaleFinalReady:true,
      humanaleBaselineFrozen:true
    })
  });
  stack.seedMemory({id:'future-memory',tags:['simulation']});
  stack.reportHealthy({timestamp:4001});
  stack.requestApproval({id:'future-approval'});
  stack.approvalManager.decide('future-approval',{
    approved:true,
    authority:'owner',
    timestamp:4002
  });
  const report=await stack.run({
    approvalId:'future-approval',
    workflowId:'future-simulation'
  });
  assert.equal(report.status,'SIMULATION_PASS');
  assert.equal(report.readiness.status,READINESS_STATUS.LIVE_READY);
  assert.equal(report.liveHumanALE,false);
  assert.equal(report.mode,'MOCK_HUMANALE_ONLY');
});
