import test from 'node:test';
import assert from 'node:assert/strict';

import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {createHumanALERuntimeHost,DEFAULT_RENDERER_EVENTS} from '../desktop/humanale-runtime-host.mjs';

function fakeTarget(){
  const messages=[];
  return {
    messages,
    isDestroyed:()=>false,
    webContents:{
      isLoading:()=>false,
      send:(channel,payload)=>messages.push({channel,payload})
    }
  };
}

test('V3 runtime host publishes legacy Core state and unified HumanALE state together',()=>{
  const nara=createOrchestrator();
  nara.start();
  const target=fakeTarget();
  const host=createHumanALERuntimeHost({
    nara,
    getTargets:()=>[target],
    isTrustedEvent:()=>true
  });

  host.start();
  nara.dispatch('audio.energy',{energy:.7,low:.2,mid:.5,high:.8},{source:'test'});

  const coreMessage=target.messages.find(item=>item.channel==='dudidam:nara-state');
  const runtimeMessage=[...target.messages].reverse().find(item=>item.channel==='dudidam:runtime-state');
  assert.ok(coreMessage);
  assert.ok(runtimeMessage);
  assert.equal(runtimeMessage.payload.version,3);
  assert.equal(runtimeMessage.payload.humanale.role,'nara-body');
  assert.equal(runtimeMessage.payload.humanale.body.hearing.active,true);
  assert.equal(runtimeMessage.payload.humanale.body.hearing.high,.8);
  assert.equal(runtimeMessage.payload.core.engine.sensory.hearing.energy,.7);

  host.stop();
  nara.stop();
});

test('V3 runtime derives HumanALE body state from authoritative NARA Core state',()=>{
  const nara=createOrchestrator();
  nara.start();
  const host=createHumanALERuntimeHost({nara,isTrustedEvent:()=>true});
  host.start();

  nara.dispatch('speech.start',{energy:.4});
  let runtime=host.snapshot();
  assert.equal(runtime.humanale.body.state,'speaking');
  assert.equal(runtime.humanale.body.speech.active,true);

  nara.dispatch('speech.stop',{});
  nara.dispatch('work.start',{id:'job',label:'Job'});
  runtime=host.snapshot();
  assert.equal(runtime.humanale.body.state,'working');

  nara.dispatch('error.detected',{message:'test'});
  runtime=host.snapshot();
  assert.equal(runtime.humanale.body.state,'warning');

  host.stop();
  nara.stop();
});

test('V3 renderer bridge accepts only sensory and region-selection events',()=>{
  const nara=createOrchestrator();
  nara.start();
  const host=createHumanALERuntimeHost({nara,isTrustedEvent:()=>true});

  const hearing=host.dispatchRenderer({},{
    event:'audio.energy',
    payload:{energy:.45,low:.1,mid:.2,high:.3}
  });
  assert.equal(hearing.ok,true);
  assert.equal(nara.snapshot().engine.sensory.hearing.energy,.45);

  const blocked=host.dispatchRenderer({},{
    event:'context.used',
    payload:{secret:'not-allowed'}
  });
  assert.match(blocked.error,/tidak diizinkan/i);
  assert.equal(DEFAULT_RENDERER_EVENTS.includes('context.used'),false);
  assert.equal(DEFAULT_RENDERER_EVENTS.includes('memory.write'),false);

  const denied=createHumanALERuntimeHost({nara,isTrustedEvent:()=>false})
    .dispatchRenderer({}, {event:'audio.energy',payload:{energy:1}});
  assert.match(denied.error,/Akses ditolak/);
  nara.stop();
});

test('V3 runtime snapshot IPC projection contains Core plus HumanALE body but no extra command surface',()=>{
  const nara=createOrchestrator();
  nara.start();
  const host=createHumanALERuntimeHost({nara,isTrustedEvent:()=>true});
  const result=host.runtimeSnapshotRequest({});
  assert.equal(result.ok,true);
  assert.equal(result.runtime.version,3);
  assert.ok(result.runtime.core);
  assert.ok(result.runtime.humanale.body);
  assert.deepEqual(Object.keys(result.runtime.humanale.channels).sort(),['coreState','state','voice']);
  assert.equal(Object.hasOwn(result.runtime,'shell'),false);
  assert.equal(Object.hasOwn(result.runtime,'terminal'),false);
  nara.stop();
});
