import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../nara-core/brain/event-bus.js';
import {
  READINESS_GATES,
  READINESS_STATUS,
  createIntegrationReadinessGate
} from '../nara-core/readiness/index.js';

const allFalse=()=>Object.fromEntries(READINESS_GATES.map(gate=>[gate,false]));
const simulationFacts=()=>({
  ...allFalse(),
  'nara.decision.validated':true,
  'nara.memory.validated':true,
  'nara.execution.validated':true,
  'nara.verification.validated':true,
  'nara.learning.validated':true,
  'nara.workflow.validated':true,
  'nara.supervisor.validated':true,
  'nara.approval.validated':true,
  'integration.contract_validated':true,
  'integration.mock_bridge_validated':true,
  'security.codeql_pass':true,
  'security.quality_gate_pass':true
});

test('readiness starts NOT_READY when required NARA gates are missing',()=>{
  const gate=createIntegrationReadinessGate({now:()=>1000});
  const report=gate.evaluate(allFalse());
  assert.equal(report.status,READINESS_STATUS.NOT_READY);
  assert.equal(report.simulationReady,false);
  assert.equal(report.liveReady,false);
  assert.ok(report.simulationMissing.includes('nara.decision.validated'));
});

test('validated NARA stack can be simulation-ready while HumanALE remains unready',()=>{
  const gate=createIntegrationReadinessGate();
  const report=gate.evaluate(simulationFacts());
  assert.equal(report.status,READINESS_STATUS.SIMULATION_READY);
  assert.equal(report.simulationReady,true);
  assert.equal(report.liveReady,false);
  assert.deepEqual(report.liveMissing.filter(item=>item.startsWith('humanale.')),[
    'humanale.real_test_pass',
    'humanale.final_ready',
    'humanale.baseline_frozen'
  ]);
});

test('live readiness requires real-test pass final-ready and frozen HumanALE baseline',()=>{
  const gate=createIntegrationReadinessGate();
  const facts=simulationFacts();
  facts['humanale.real_test_pass']=true;
  facts['humanale.final_ready']=true;
  let report=gate.evaluate(facts);
  assert.equal(report.liveReady,false);
  assert.deepEqual(report.liveMissing,['humanale.baseline_frozen']);

  facts['humanale.baseline_frozen']=true;
  report=gate.evaluate(facts);
  assert.equal(report.status,READINESS_STATUS.LIVE_READY);
  assert.equal(report.liveReady,true);
});

test('one failed security or NARA gate blocks both simulation and live readiness',()=>{
  const gate=createIntegrationReadinessGate();
  const facts=simulationFacts();
  facts['humanale.real_test_pass']=true;
  facts['humanale.final_ready']=true;
  facts['humanale.baseline_frozen']=true;
  facts['security.codeql_pass']=false;
  const report=gate.evaluate(facts);
  assert.equal(report.status,READINESS_STATUS.NOT_READY);
  assert.equal(report.simulationReady,false);
  assert.equal(report.liveReady,false);
  assert.ok(report.simulationMissing.includes('security.codeql_pass'));
});

test('unknown or non-boolean facts are rejected',()=>{
  const gate=createIntegrationReadinessGate();
  assert.throws(()=>gate.evaluate({
    ...simulationFacts(),
    'bypass.everything':true
  }),/Unknown readiness gate/);
  assert.throws(()=>gate.evaluate({
    ...simulationFacts(),
    'nara.decision.validated':'yes'
  }),/must be boolean/);
});

test('readiness API contains no activation or bypass method',()=>{
  const gate=createIntegrationReadinessGate();
  assert.equal(typeof gate.activate,'undefined');
  assert.equal(typeof gate.forceReady,'undefined');
  assert.equal(typeof gate.skipGate,'undefined');
  assert.equal(typeof gate.override,'undefined');
});

test('readiness history is bounded',()=>{
  const gate=createIntegrationReadinessGate({limits:{historyLimit:2}});
  gate.evaluate(allFalse());
  gate.evaluate(simulationFacts());
  const facts=simulationFacts();
  facts['humanale.real_test_pass']=true;
  facts['humanale.final_ready']=true;
  facts['humanale.baseline_frozen']=true;
  gate.evaluate(facts);
  assert.equal(gate.recent({limit:10}).length,2);
});

test('Event Bus emits only aggregate readiness metadata',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const gate=createIntegrationReadinessGate({bus});
  gate.evaluate(simulationFacts());
  const serialized=JSON.stringify(events);
  assert.match(serialized,/readiness\.evaluated/);
  assert.equal(serialized.includes('prompt'),false);
  assert.equal(serialized.includes('secret'),false);
  assert.equal(serialized.includes('chain-of-thought'),false);
});

test('canActivateLive stays false until every live gate is true',()=>{
  const gate=createIntegrationReadinessGate();
  assert.equal(gate.canActivateLive(simulationFacts()),false);
  const facts=simulationFacts();
  facts['humanale.real_test_pass']=true;
  facts['humanale.final_ready']=true;
  facts['humanale.baseline_frozen']=true;
  assert.equal(gate.canActivateLive(facts),true);
});
