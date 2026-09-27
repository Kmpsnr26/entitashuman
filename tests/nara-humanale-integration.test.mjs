import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEGRATION_DIRECTIONS,
  createIntegrationMessage,
  validateIntegrationMessage,
  createHumanALEHealthTracker,
  createNaraHumanALEBridge,
  createMockHumanALE
} from '../nara-core/integration/index.js';

test('integration protocol accepts only direction-specific allowlisted JSON messages',()=>{
  const message=createIntegrationMessage({
    direction:INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE,
    id:'msg-1',
    timestamp:1000,
    type:'avatar.expression',
    payload:{name:'listening',intensity:.5}
  });
  assert.equal(validateIntegrationMessage(message).ok,true);

  const wrongType={...message,type:'terminal.exec'};
  const invalid=validateIntegrationMessage(wrongType);
  assert.equal(invalid.ok,false);
  assert.match(invalid.errors.join(' '),/not allowlisted/);

  const wrongDirection={...message,source:'HUMANALE',target:'NARA_CORE'};
  assert.equal(validateIntegrationMessage(wrongDirection,{
    direction:INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE
  }).ok,false);

  const cyclic={};
  cyclic.self=cyclic;
  assert.throws(()=>createIntegrationMessage({
    direction:INTEGRATION_DIRECTIONS.NARA_TO_HUMANALE,
    id:'msg-cyclic',
    timestamp:1000,
    type:'system.state',
    payload:cyclic
  }),/JSON-compatible/);
});

test('HumanALE health tracker enforces lifecycle transitions',()=>{
  let time=10;
  const health=createHumanALEHealthTracker({now:()=>++time});
  health.transition('STARTING',{reason:'launch'});
  health.transition('READY',{reason:'renderer ready'});
  health.transition('BUSY',{reason:'animation'});
  health.transition('READY',{reason:'idle'});
  health.transition('DEGRADED',{reason:'frame budget'});
  health.transition('RECOVERING',{reason:'reinitialize'});
  health.transition('READY',{reason:'recovered'});
  assert.equal(health.state,'READY');
  assert.throws(()=>health.transition('STARTING'),/Invalid HumanALE health transition/);
  assert.equal(health.snapshot().history.at(-1).reason,'recovered');
});

test('mock bridge delivers allowlisted NARA command and records matching ack',async()=>{
  let id=0;
  const mock=createMockHumanALE();
  const bridge=createNaraHumanALEBridge({
    transport:mock,
    idFactory:()=>`out-${++id}`,
    now:()=>1000
  });
  bridge.enqueue('avatar.motion',{preset:'idle-breathe'});
  const result=await bridge.flush();
  assert.deepEqual(result,{attempted:1,delivered:1,retried:0,failed:0,pending:0});
  assert.equal(mock.snapshot().received.length,1);
  assert.equal(bridge.snapshot().acknowledgements[0].id,'out-1');
});

test('bridge retries transient failures without duplicating accepted mock messages',async()=>{
  let id=0;
  const mock=createMockHumanALE({failuresBeforeAck:2});
  const bridge=createNaraHumanALEBridge({
    transport:mock,
    idFactory:()=>`retry-${++id}`,
    maxRetries:2,
    now:()=>2000
  });
  bridge.enqueue('system.ping',{sequence:1});

  const first=await bridge.flush();
  assert.equal(first.retried,1);
  assert.equal(first.pending,1);
  const second=await bridge.flush();
  assert.equal(second.retried,1);
  assert.equal(second.pending,1);
  const third=await bridge.flush();
  assert.equal(third.delivered,1);
  assert.equal(third.pending,0);

  const snap=bridge.snapshot();
  assert.equal(snap.counters.retried,2);
  assert.equal(snap.counters.delivered,1);
  assert.equal(mock.snapshot().received.length,1);
});

test('bridge dead-letters permanent rejection instead of retrying forever',async()=>{
  const transport={
    async send(){return {ok:false,retryable:false,error:'policy denied'};}
  };
  const bridge=createNaraHumanALEBridge({
    transport,
    idFactory:()=> 'reject-1',
    now:()=>3000,
    maxRetries:5
  });
  bridge.enqueue('speech.start',{text:'hello'});
  const result=await bridge.flush();
  assert.equal(result.failed,1);
  assert.equal(result.pending,0);
  assert.equal(bridge.snapshot().deadLetters[0].error,'policy denied');
});

test('bridge deduplicates HumanALE inbound events and synchronizes health',()=>{
  const mock=createMockHumanALE();
  const bridge=createNaraHumanALEBridge({now:()=>4000});
  const starting=mock.emit('runtime.health',{state:'STARTING',reason:'boot'},{id:'health-1',timestamp:4000});
  const ready=mock.emit('runtime.health',{state:'READY',reason:'ready'},{id:'health-2',timestamp:4001});

  assert.equal(bridge.receive(starting).ok,true);
  assert.equal(bridge.receive(ready).ok,true);
  const duplicate=bridge.receive(ready);
  assert.equal(duplicate.ok,true);
  assert.equal(duplicate.duplicate,true);

  const snap=bridge.snapshot();
  assert.equal(snap.health.state,'READY');
  assert.equal(snap.counters.inboundAccepted,2);
  assert.equal(snap.counters.inboundDuplicates,1);
  assert.equal(snap.inboundHistory.length,2);
});

test('bridge rejects malformed HumanALE input and bounds outbound queue',()=>{
  let id=0;
  const bridge=createNaraHumanALEBridge({
    maxQueue:2,
    idFactory:()=>`bounded-${++id}`
  });
  bridge.enqueue('avatar.expression',{name:'idle'});
  bridge.enqueue('avatar.motion',{name:'breathe'});
  assert.throws(()=>bridge.enqueue('system.ping',{}),/queue is full/);

  const invalid=bridge.receive({
    version:'1.0.0',
    id:'bad-1',
    timestamp:1,
    source:'HUMANALE',
    target:'NARA_CORE',
    type:'terminal.exec',
    payload:{command:'whoami'}
  });
  assert.equal(invalid.ok,false);
  assert.equal(bridge.snapshot().counters.inboundRejected,1);
});
