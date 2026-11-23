import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTaskScheduler,
  createWatchdog,
  createRecoveryEngine,
  createInstinctEngine,
  createExperienceModel,
  createCapabilityBroker,
  createAutopilot
} from '../alecore-ai/engine/index.js';
import {createOrchestrator} from '../alecore-ai/brain/orchestrator.js';

test('task scheduler honors priority and dependencies',()=>{
  const scheduler=createTaskScheduler();
  scheduler.enqueue({id:'base',handler:'safe.base',priority:20});
  scheduler.enqueue({id:'dependent',handler:'safe.dep',priority:100,dependencies:['base']});
  scheduler.enqueue({id:'other',handler:'safe.other',priority:60});
  assert.equal(scheduler.next().id,'other');
  scheduler.start('other');scheduler.complete('other');
  assert.equal(scheduler.next().id,'base');
  scheduler.start('base');scheduler.complete('base');
  assert.equal(scheduler.next().id,'dependent');
});

test('watchdog only marks overdue registered tasks as stalled',()=>{
  const watchdog=createWatchdog({defaultTimeoutMs:1000});
  const item=watchdog.track('task-a',{timeoutMs:1000,label:'A'});
  assert.equal(watchdog.inspect(item.heartbeatAt+999).length,0);
  const stale=watchdog.inspect(item.heartbeatAt+1001);
  assert.equal(stale.length,1);
  assert.equal(stale[0].id,'task-a');
  assert.equal(watchdog.snapshot().stalled,1);
});

test('recovery engine keeps retries bounded and escalates auth or policy failures',()=>{
  const recovery=createRecoveryEngine({maxRetries:2});
  assert.equal(recovery.decide({attempt:0,errorCategory:'runtime'}).action,'escalate');
  assert.equal(recovery.decide({attempt:0,errorCategory:'runtime'}).reason,
    'unsafe-retry-requires-idempotency-or-confirmed-compensation');
  assert.equal(recovery.decide({attempt:0,errorCategory:'runtime',idempotent:true}).action,'retry');
  assert.equal(recovery.decide({attempt:1,errorCategory:'runtime',idempotent:true}).action,'retry');
  assert.equal(recovery.decide({attempt:2,errorCategory:'runtime',idempotent:true}).action,'escalate');
  assert.equal(recovery.decide({attempt:0,errorCategory:'auth'}).action,'escalate');
  assert.equal(recovery.decide({
    attempt:0,
    errorCategory:'runtime',
    capabilityRequired:true,
    capabilityApproved:false
  }).reason,'owner-approval-required');
});

test('instinct engine exposes transparent operational signals without private reasoning',()=>{
  const instinct=createInstinctEngine();
  const result=instinct.evaluate({
    sensory:{
      system:{memoryUsedRatio:.94,cpuLoad:.97},
      server:{health:'degraded'},
      hearing:{energy:.5},
      vision:{activity:.2}
    },
    diagnostics:{errors:1,failures:1},
    task:{status:'stalled'}
  });
  assert.ok(result.risk>.7);
  assert.ok(result.urgency>.7);
  assert.ok(result.anomalies.includes('memory-pressure'));
  assert.ok(result.anomalies.includes('task-stalled'));
  assert.equal(Object.hasOwn(result,'reasoning'),false);
  assert.equal(Object.hasOwn(result,'chainOfThought'),false);
});

test('experience model adapts only among explicit registered strategy ids',()=>{
  const model=createExperienceModel();
  model.record('strategy.a',{ok:false});
  model.record('strategy.a',{ok:false});
  model.record('strategy.b',{ok:true});
  assert.equal(model.choose(['strategy.a','strategy.b']),'strategy.b');
  assert.equal(model.choose([]),null);
  assert.throws(()=>model.record('../unsafe',{ok:true}),/tidak valid/i);
});

test('autopilot executes only registered handlers and rejects missing handlers',async()=>{
  const scheduler=createTaskScheduler();
  const watchdog=createWatchdog();
  const recovery=createRecoveryEngine();
  const capabilities=createCapabilityBroker();
  const experience=createExperienceModel();
  const events=[];
  const autopilot=createAutopilot({
    scheduler,watchdog,recovery,capabilities,experience,
    onEvent:(event,payload)=>events.push({event,payload})
  });

  autopilot.enqueue({id:'missing',handler:'unregistered.handler'});
  const missing=await autopilot.runNext();
  assert.equal(missing.ok,false);
  assert.equal(missing.reason,'handler-not-registered');
  assert.equal(scheduler.get('missing').status,'failed');

  autopilot.registerHandler('safe.echo',async({task,heartbeat})=>{
    heartbeat();
    return {id:task.id,ok:true};
  });
  autopilot.enqueue({id:'safe',handler:'safe.echo',priority:90});
  const result=await autopilot.runNext();
  assert.equal(result.ok,true);
  assert.equal(scheduler.get('safe').status,'complete');
  assert.ok(events.some(item=>item.event==='autopilot.task.complete'));
});

test('autopilot blocks capability-protected task until Creator and OS approve it',async()=>{
  const scheduler=createTaskScheduler();
  const watchdog=createWatchdog();
  const recovery=createRecoveryEngine();
  const capabilities=createCapabilityBroker();
  const experience=createExperienceModel();
  let runs=0;
  const autopilot=createAutopilot({
    scheduler,watchdog,recovery,capabilities,experience
  });
  autopilot.registerHandler('system.maintenance',async()=>{runs+=1;return {ok:true};},{
    capability:'os.privileged.action'
  });
  autopilot.enqueue({id:'maintenance',handler:'system.maintenance',priority:100});

  const blocked=await autopilot.runNext();
  assert.equal(blocked.ok,false);
  assert.equal(runs,0);
  assert.equal(scheduler.get('maintenance').status,'queued');

  const request=capabilities.request('os.privileged.action',{reason:'Owner maintenance'});
  capabilities.approve(request.id,{actor:'creator',osConfirmed:true,ttlMs:60000});
  const approved=await autopilot.runNext();
  assert.equal(approved.ok,true);
  assert.equal(runs,1);
});

test('AleCore AI orchestrator exposes bounded autopilot and operational instinct in Core snapshot',async()=>{
  const ale=createOrchestrator();
  ale.start();
  ale.registerAutopilotHandler('internal.health',async()=>({health:'ok'}));
  ale.queueAutopilotTask({id:'health-check',handler:'internal.health',priority:80});
  const result=await ale.runAutopilotOnce();
  assert.equal(result.ok,true);
  const snapshot=ale.snapshot();
  assert.equal(snapshot.engine.autopilot.scheduler.complete,1);
  assert.equal(snapshot.engine.autopilot.handlers.includes('internal.health'),true);
  assert.equal(typeof snapshot.engine.instinct.confidence,'number');
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'complete');
  assert.equal(snapshot.regions.FOLLOW_UP.status,'active');
  ale.stop();
});
