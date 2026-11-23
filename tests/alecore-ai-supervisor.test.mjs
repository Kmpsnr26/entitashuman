import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../alecore-ai/brain/event-bus.js';
import {
  CIRCUIT_STATE,
  RECOVERY_RECOMMENDATION,
  createSupervisor
} from '../alecore-ai/supervisor/index.js';

test('healthy registered component is allowed to run',()=>{
  const supervisor=createSupervisor({now:()=>1000});
  supervisor.register({id:'decision'});
  supervisor.report({componentId:'decision',status:'healthy',latencyMs:10,timestamp:1000});
  const gate=supervisor.canRun('decision',{timestamp:1001});
  assert.equal(gate.allowed,true);
  assert.equal(gate.reason,'healthy');
});

test('repeated errors inside window open circuit and block work',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'executor',errorThreshold:3,errorWindowMs:1000,cooldownMs:500});
  supervisor.report({componentId:'executor',status:'error',errorCode:'e1',timestamp:1000});
  supervisor.report({componentId:'executor',status:'error',errorCode:'e2',timestamp:1100});
  supervisor.report({componentId:'executor',status:'error',errorCode:'e3',timestamp:1200});
  const component=supervisor.get('executor');
  assert.equal(component.circuit,CIRCUIT_STATE.OPEN);
  assert.equal(supervisor.canRun('executor',{timestamp:1201}).allowed,false);
  assert.equal(supervisor.snapshot().counters.circuitsOpened,1);
});

test('cooldown never auto-recovers; explicit probe is required',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'verification',errorThreshold:1,cooldownMs:100});
  supervisor.report({componentId:'verification',status:'error',errorCode:'failure',timestamp:1000});
  assert.equal(
    supervisor.recommend('verification',{timestamp:1050}).type,
    RECOVERY_RECOMMENDATION.WAIT_COOLDOWN
  );
  assert.equal(
    supervisor.recommend('verification',{timestamp:1100}).type,
    RECOVERY_RECOMMENDATION.RUN_HEALTH_PROBE
  );
  assert.equal(supervisor.canRun('verification',{timestamp:1100}).allowed,false);
  assert.throws(()=>supervisor.completeProbe('verification',{ok:true,timestamp:1100}),/No active/);
  supervisor.beginProbe('verification',{timestamp:1100});
  assert.equal(supervisor.get('verification').circuit,CIRCUIT_STATE.HALF_OPEN);
  supervisor.completeProbe('verification',{ok:true,status:'healthy',timestamp:1110});
  assert.equal(supervisor.get('verification').circuit,CIRCUIT_STATE.CLOSED);
  assert.equal(supervisor.canRun('verification',{timestamp:1111}).allowed,true);
});

test('failed half-open probe reopens circuit without external recovery action',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'memory',errorThreshold:1,cooldownMs:50});
  supervisor.report({componentId:'memory',status:'error',errorCode:'e1',timestamp:100});
  supervisor.beginProbe('memory',{timestamp:150});
  supervisor.completeProbe('memory',{ok:false,errorCode:'probe_bad',timestamp:160});
  const component=supervisor.get('memory');
  assert.equal(component.circuit,CIRCUIT_STATE.OPEN);
  assert.equal(component.status,'error');
  assert.equal(component.lastErrorCode,'probe_bad');
  assert.equal(typeof supervisor.restart,'undefined');
  assert.equal(typeof supervisor.kill,'undefined');
  assert.equal(typeof supervisor.repair,'undefined');
});

test('heartbeat sweep marks stale and can open circuit',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'learning',heartbeatTimeoutMs:100,errorThreshold:1});
  supervisor.report({componentId:'learning',status:'healthy',timestamp:1000});
  assert.deepEqual(supervisor.sweep({timestamp:1099}),[]);
  assert.deepEqual(supervisor.sweep({timestamp:1101}),['learning']);
  const component=supervisor.get('learning');
  assert.equal(component.status,'stale');
  assert.equal(component.lastErrorCode,'heartbeat_timeout');
  assert.equal(component.circuit,CIRCUIT_STATE.OPEN);
});

test('degraded component requires explicit allowDegraded policy',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'strict',allowDegraded:false});
  supervisor.register({id:'tolerant',allowDegraded:true});
  supervisor.report({componentId:'strict',status:'degraded',timestamp:1});
  supervisor.report({componentId:'tolerant',status:'degraded',timestamp:1});
  assert.equal(supervisor.canRun('strict',{timestamp:2}).allowed,false);
  assert.equal(supervisor.canRun('tolerant',{timestamp:2}).allowed,true);
  assert.equal(supervisor.recommend('strict',{timestamp:2}).type,RECOVERY_RECOMMENDATION.CHECK_DEPENDENCY);
});

test('supervisor rejects arbitrary error text and excessive latency',()=>{
  const supervisor=createSupervisor({limits:{maxLatencyMs:100}});
  supervisor.register({id:'component'});
  assert.throws(()=>supervisor.report({
    componentId:'component',
    status:'error',
    errorCode:'contains spaces and private text',
    timestamp:1
  }),/error code/);
  assert.throws(()=>supervisor.report({
    componentId:'component',
    status:'healthy',
    latencyMs:101,
    timestamp:1
  }),/latencyMs/);
});

test('incident history is bounded',()=>{
  const supervisor=createSupervisor({
    limits:{incidentHistoryLimit:3,componentHistoryLimit:2}
  });
  supervisor.register({id:'bounded',errorThreshold:100});
  for(let i=0;i<6;i++){
    supervisor.report({componentId:'bounded',status:'error',errorCode:'e'+i,timestamp:100+i});
  }
  assert.equal(supervisor.recentIncidents({limit:20}).length,3);
  assert.equal(supervisor.get('bounded').incidents,2);
  assert.equal(supervisor.snapshot().counters.incidents,6);
});

test('Event Bus telemetry contains metadata only',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const supervisor=createSupervisor({bus});
  supervisor.register({id:'executor',errorThreshold:1});
  supervisor.report({componentId:'executor',status:'error',errorCode:'handler_error',timestamp:1});
  const serialized=JSON.stringify(events);
  assert.match(serialized,/supervisor\.incident/);
  assert.match(serialized,/supervisor\.circuit\.open/);
  assert.equal(serialized.includes('prompt'),false);
  assert.equal(serialized.includes('output'),false);
  assert.equal(serialized.includes('chain-of-thought'),false);
});

test('recovery recommendations are review-only and never auto-execute',()=>{
  const supervisor=createSupervisor();
  supervisor.register({id:'offline',errorThreshold:2});
  supervisor.report({componentId:'offline',status:'offline',timestamp:1});
  const recommendation=supervisor.recommend('offline',{timestamp:2});
  assert.equal(recommendation.status,'review_required');
  assert.equal(recommendation.requiresApproval,true);
  assert.equal(recommendation.autoExecute,false);
  assert.equal(recommendation.type,RECOVERY_RECOMMENDATION.REVIEW_COMPONENT);
});
