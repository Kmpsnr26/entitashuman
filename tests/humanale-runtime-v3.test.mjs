import test from 'node:test';
import assert from 'node:assert/strict';

import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {createHumanALERuntimeHost,DEFAULT_RENDERER_EVENTS} from '../desktop/humanale-runtime-host.mjs';
import {
  NARA_UNIFIED_RUNTIME_CONTRACT,
  normalizeHumanALEInput
} from '../nara-core/runtime/unified-contract.js';

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
  assert.equal(runtimeMessage.payload.contract.version,1);
  assert.equal(runtimeMessage.payload.contract.roles.naraCore,'brain');
  assert.equal(runtimeMessage.payload.contract.roles.humanale,'body');
  assert.equal(runtimeMessage.payload.authority.renderer,'sensory-only');
  assert.equal(runtimeMessage.payload.authority.privilegedActions,'capability-broker');
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


test('V3.4 runtime contract strips unknown fields and clamps sensory data',()=>{
  assert.equal(NARA_UNIFIED_RUNTIME_CONTRACT.runtimeVersion,3);
  assert.equal(NARA_UNIFIED_RUNTIME_CONTRACT.authority.arbitraryShell,false);
  assert.equal(NARA_UNIFIED_RUNTIME_CONTRACT.authority.authenticationBypass,false);
  assert.equal(NARA_UNIFIED_RUNTIME_CONTRACT.authority.rootExploit,false);

  const audio=normalizeHumanALEInput('audio.energy',{
    energy:9,
    low:-4,
    mid:.4,
    high:.8,
    password:'must-not-survive',
    raw:new Array(10).fill('x')
  });
  assert.deepEqual(audio,{energy:1,low:0,mid:.4,high:.8});
  assert.equal(Object.hasOwn(audio,'password'),false);
  assert.equal(Object.hasOwn(audio,'raw'),false);

  const vision=normalizeHumanALEInput('vision.frame',{
    activity:2,
    frameId:'frame-'+('x'.repeat(300)),
    image:'base64-secret-image'
  });
  assert.equal(vision.activity,1);
  assert.ok(vision.frameId.length<=120);
  assert.equal(Object.hasOwn(vision,'image'),false);

  assert.equal(normalizeHumanALEInput('brain.region.select',{region:'NOT_A_REGION'}),null);
  assert.deepEqual(normalizeHumanALEInput('speech.stop',{secret:'drop-me'}),{});
  assert.equal(normalizeHumanALEInput('memory.write',{label:'blocked'}),null);
});

test('V3.4 runtime host rejects oversized renderer envelopes and sanitized payload reaches Core',()=>{
  const nara=createOrchestrator();
  nara.start();
  const host=createHumanALERuntimeHost({nara,isTrustedEvent:()=>true});

  const oversized=host.dispatchRenderer({},{
    event:'vision.frame',
    payload:{activity:.8,frameId:'x'.repeat(5000)}
  });
  assert.match(oversized.error,/terlalu besar/i);

  const accepted=host.dispatchRenderer({},{
    event:'vision.frame',
    payload:{activity:5,frameId:'safe-frame',secret:'discard'}
  });
  assert.equal(accepted.ok,true);
  const vision=nara.snapshot().engine.sensory.vision;
  assert.equal(vision.activity,1);
  assert.equal(vision.frameId,'safe-frame');
  assert.equal(Object.hasOwn(vision,'secret'),false);
  nara.stop();
});
