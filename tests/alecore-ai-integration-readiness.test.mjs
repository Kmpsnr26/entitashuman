import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../ALECORE-AI/brain/event-bus.js';
import {
  READINESS_GATES,
  READINESS_STATUS,
  createIntegrationReadinessGate
} from '../ALECORE-AI/readiness/index.js';

const allFalse=()=>Object.fromEntries(READINESS_GATES.map(gate=>[gate,false]));
const simulationFacts=()=>({
  ...allFalse(),
  'ale.decision.validated':true,
  'ale.memory.validated':true,
  'ale.execution.validated':true,
  'ale.verification.validated':true,
  'ale.learning.validated':true,
  'ale.workflow.validated':true,
  'ale.supervisor.validated':true,
  'ale.approval.validated':true,
  'integration.contract_validated':true,
  'integration.mock_bridge_validated':true,
  'security.codeql_pass':true,
  'security.quality_gate_pass':true
});

test('readiness starts NOT_READY when required AleCore AI gates are missing',()=>{
  const gate=createIntegrationReadinessGate({now:()=>1000});
  const report=gate.evaluate(allFalse());
  assert.equal(report.status,READINESS_STATUS.NOT_READY);
  assert.equal(report.simulationReady,false);
  assert.equal(report.liveReady,false);
});

test('validated AleCore AI stack is simulation-ready while HumanALE and creator approval remain locked',()=>{
  const gate=createIntegrationReadinessGate();
  const report=gate.evaluate(simulationFacts());
  assert.equal(report.status,READINESS_STATUS.SIMULATION_READY);
  assert.equal(report.simulationReady,true);
  assert.equal(report.liveReady,false);
  assert.deepEqual(report.liveMissing.filter(item=>item.startsWith('humanale.')),[
    'humanale.real_test_pass',
    'humanale.final_ready',
    'humanale.baseline_frozen',
    'humanale.creator_final_approval'
  ]);
});

test('live readiness requires technical HumanALE gates plus explicit creator final approval',()=>{
  const gate=createIntegrationReadinessGate();
  const facts=simulationFacts();
  facts['humanale.real_test_pass']=true;
  facts['humanale.final_ready']=true;
  facts['humanale.baseline_frozen']=true;
  let report=gate.evaluate(facts);
  assert.equal(report.liveReady,false);
  assert.deepEqual(report.liveMissing,['humanale.creator_final_approval']);

  facts['humanale.creator_final_approval']=true;
  report=gate.evaluate(facts);
  assert.equal(report.status,READINESS_STATUS.LIVE_READY);
  assert.equal(report.liveReady,true);
});

test('one failed security gate blocks simulation and live readiness',()=>{
  const gate=createIntegrationReadinessGate();
  const facts=simulationFacts();
  facts['security.codeql_pass']=false;
  const report=gate.evaluate(facts);
  assert.equal(report.status,READINESS_STATUS.NOT_READY);
  assert.equal(report.simulationReady,false);
  assert.equal(report.liveReady,false);
});

test('unknown or non-boolean readiness facts are rejected',()=>{
  const gate=createIntegrationReadinessGate();
  assert.throws(()=>gate.evaluate({...simulationFacts(),'bypass.everything':true}),/Unknown readiness gate/);
  assert.throws(()=>gate.evaluate({...simulationFacts(),'ale.decision.validated':'yes'}),/must be boolean/);
});

test('readiness API has no activation or bypass method',()=>{
  const gate=createIntegrationReadinessGate();
  for(const name of ['activate','forceReady','skipGate','override']){
    assert.equal(typeof gate[name],'undefined',name);
  }
});

test('readiness history is bounded and event metadata remains aggregate only',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const gate=createIntegrationReadinessGate({bus,limits:{historyLimit:2}});
  gate.evaluate(allFalse());
  gate.evaluate(simulationFacts());
  gate.evaluate(simulationFacts());
  assert.equal(gate.recent({limit:10}).length,2);
  const serialized=JSON.stringify(events);
  assert.match(serialized,/readiness\.evaluated/);
  assert.equal(serialized.includes('prompt'),false);
  assert.equal(serialized.includes('secret'),false);
  assert.equal(serialized.includes('chain-of-thought'),false);
});
