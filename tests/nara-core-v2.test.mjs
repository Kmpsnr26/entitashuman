import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {
  createSensoryFusion,
  createCapabilityBroker,
  integrationPlan,
  NARA_IDENTITY
} from '../nara-core/engine/index.js';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {createOwnerStore} from '../nara-core/security/owner-store.mjs';
import {createCreatorAuth} from '../nara-core/studio/creator-auth.mjs';
import {createSystemObserver,createDataFlowMeter} from '../desktop/system-observer.mjs';

test('NARA Core V2 identity is stable and permissioned',()=>{
  assert.equal(NARA_IDENTITY.id,'NARA');
  assert.equal(NARA_IDENTITY.creatorAuthority,'owner-only');
  assert.equal(NARA_IDENTITY.integrationMode,'permissioned-adaptive');
  assert.equal(NARA_IDENTITY.voicePersistent,true);
  assert.equal(NARA_IDENTITY.hiddenAutonomy,false);
});

test('sensory fusion observes host server and app flow without raw network discovery',()=>{
  const senses=createSensoryFusion();
  senses.consume({event:'system.telemetry',timestamp:1,payload:{
    platform:'win32',
    hostname:'creator-pc',
    arch:'x64',
    cpuLoad:.42,
    memoryUsedRatio:.63,
    processMemoryMb:128,
    interfaces:[
      {name:'Ethernet',family:'IPv4',address:'192.168.1.10',internal:false,mac:'SHOULD_NOT_SURVIVE'}
    ]
  }});
  senses.consume({event:'server.observe',timestamp:2,payload:{
    scope:'loopback',host:'127.0.0.1',port:4178,transport:'HTTP',health:'online',secret:'NO'
  }});
  senses.consume({event:'dataflow.sample',timestamp:3,payload:{
    inBytes:100,outBytes:250,inEvents:2,outEvents:3,inRate:20,outRate:50,lastDirection:'duplex'
  }});
  const snapshot=senses.snapshot();
  assert.equal(snapshot.system.hostname,'creator-pc');
  assert.equal(snapshot.system.interfaces[0].address,'192.168.1.10');
  assert.equal(Object.hasOwn(snapshot.system.interfaces[0],'mac'),false);
  assert.equal(snapshot.server.host,'127.0.0.1');
  assert.equal(Object.hasOwn(snapshot.server,'secret'),false);
  assert.equal(snapshot.dataFlow.outBytes,250);
});

test('capability broker has no root exploit or auth bypass capability',()=>{
  const broker=createCapabilityBroker();
  assert.throws(()=>broker.request('root.exploit'),/tidak dikenal/i);
  assert.throws(()=>broker.request('auth.bypass'),/tidak dikenal/i);
  const snapshot=broker.snapshot();
  assert.equal(snapshot.policy.rootExploit,false);
  assert.equal(snapshot.policy.authenticationBypass,false);
  assert.equal(snapshot.policy.credentialBypass,false);
  assert.equal(snapshot.policy.arbitraryNetworkDiscovery,false);
});

test('privileged OS capability requires creator and explicit OS confirmation',()=>{
  const broker=createCapabilityBroker();
  const request=broker.request('os.privileged.action',{reason:'Owner maintenance'});
  assert.throws(()=>broker.approve(request.id,{actor:'agent',osConfirmed:true}),/creator/i);
  assert.throws(()=>broker.approve(request.id,{actor:'creator',osConfirmed:false}),/izin OS/i);
  const approved=broker.approve(request.id,{actor:'creator',osConfirmed:true,ttlMs:60000});
  assert.equal(approved.status,'approved');
  assert.equal(broker.authorize('os.privileged.action').ok,true);
  assert.equal(broker.revoke('os.privileged.action',{actor:'creator'}),true);
  assert.equal(broker.authorize('os.privileged.action').ok,false);
});

test('orchestrator exposes V2 engine snapshot and Safety follows capability lifecycle',()=>{
  const nara=createOrchestrator({
    deviceProfile:{platform:'win32',arch:'x64',hostname:'pc',adapters:['microphone','camera','admin-elevation']}
  });
  nara.start();
  nara.dispatch('system.telemetry',{platform:'win32',hostname:'pc',arch:'x64',cpuLoad:.1,memoryUsedRatio:.2});
  nara.dispatch('server.observe',{scope:'loopback',host:'127.0.0.1',port:4178,transport:'HTTP',health:'online'});
  const request=nara.requestCapability('creator.login.change',{actor:'nara-core'});
  assert.equal(nara.snapshot().regions.SAFETY.status,'processing');
  nara.denyCapability(request.id,{actor:'creator'});
  const snapshot=nara.snapshot();
  assert.equal(snapshot.engine.identity.id,'NARA');
  assert.equal(snapshot.engine.sensory.system.hostname,'pc');
  assert.equal(snapshot.engine.sensory.server.port,4178);
  assert.equal(snapshot.regions.SAFETY.status,'paused');
  nara.stop();
});

test('device integration plan adapts only through declared permissioned adapters',()=>{
  const plan=integrationPlan({
    platform:'win32',release:'test',arch:'x64',hostname:'pc',
    adapters:['microphone','camera','admin-elevation','unknown-hidden-adapter']
  });
  assert.equal(plan.device.integrationMode,'permissioned-adaptive');
  assert.equal(plan.plan.find(item=>item.id==='audio.input').enabled,true);
  assert.equal(plan.plan.find(item=>item.id==='camera.input').enabled,true);
  assert.equal(plan.plan.find(item=>item.id==='privileged.os').permission,'owner+os');
  assert.ok(plan.forbidden.includes('credential-bypass'));
  assert.ok(plan.forbidden.includes('root-exploit'));
  assert.ok(plan.forbidden.includes('hidden-persistence'));
});

test('persistent owner store keeps immutable owner id and never stores plaintext password',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nara-owner-test-'));
  const file=join(dir,'owner.json');
  try{
    const store=createOwnerStore({filePath:file});
    const first=store.provision({username:'creator',password:'InitialPass123!'});
    assert.equal(first.configured,true);
    assert.equal(store.verify({username:'creator',password:'InitialPass123!'}),true);
    const source=readFileSync(file,'utf8');
    assert.equal(source.includes('InitialPass123!'),false);
    assert.equal(source.includes('passwordHash'),true);

    const changed=store.changeCredentials({
      currentUsername:'creator',
      currentPassword:'InitialPass123!',
      newUsername:'owner.nara',
      newPassword:'ChangedPass456!'
    });
    assert.equal(changed.ownerId,first.ownerId);
    assert.equal(changed.deviceId,first.deviceId);
    assert.equal(store.verify({username:'creator',password:'InitialPass123!'}),false);
    assert.equal(store.verify({username:'owner.nara',password:'ChangedPass456!'}),true);
    assert.equal(readFileSync(file,'utf8').includes('ChangedPass456!'),false);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Creator auth uses owner store and login changes require authenticated owner plus old password',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nara-auth-test-'));
  const file=join(dir,'owner.json');
  try{
    const store=createOwnerStore({filePath:file});
    store.provision({username:'creator',password:'CreatorPass123!'});
    const auth=createCreatorAuth({credentialStore:store,ttlMs:60000});
    const req={socket:{remoteAddress:'127.0.0.1'},headers:{cookie:''}};
    const login=auth.login(req,{username:'creator',password:'CreatorPass123!'});
    assert.equal(login.ok,true);
    req.headers.cookie='nara_creator_session='+encodeURIComponent(login.token);

    const rejected=auth.changeCredentials(req,{
      currentPassword:'wrong-password',
      newUsername:'creator2',
      newPassword:'NewCreatorPass123!'
    });
    assert.equal(rejected.ok,false);

    const changed=auth.changeCredentials(req,{
      currentPassword:'CreatorPass123!',
      newUsername:'creator2',
      newPassword:'NewCreatorPass123!'
    });
    assert.equal(changed.ok,true);
    assert.equal(store.verify({username:'creator2',password:'NewCreatorPass123!'}),true);
    assert.equal(auth.getSession(req),null);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Creator auth fallback compares exact credentials and accepts only its session cookie',()=>{
  const auth=createCreatorAuth({
    username:'owner',
    password:'CreatorPass123!',
    ttlMs:60000
  });
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{cookie:''}};

  assert.equal(auth.login(req,{username:'owner',password:'CreatorPass123?'}).ok,false);
  assert.equal(auth.login(req,{username:'ownerx',password:'CreatorPass123!'}).ok,false);

  const login=auth.login(req,{username:'owner',password:'CreatorPass123!'});
  assert.equal(login.ok,true);
  req.headers.cookie=[
    '__proto__=polluted',
    'constructor=malicious',
    'unrelated=value',
    'nara_creator_session='+encodeURIComponent(login.token)
  ].join('; ');
  assert.equal(auth.getSession(req)?.username,'owner');
  assert.equal(Object.prototype.polluted,undefined);

  req.headers.cookie='nara_creator_session=%E0%A4%A';
  assert.equal(auth.getSession(req),null);
  assert.doesNotThrow(()=>auth.logout(req));
});

test('system observer exposes only own interface metadata and data-flow meter counts NARA payloads',()=>{
  const observer=createSystemObserver({intervalMs:1000});
  const snapshot=observer.snapshot();
  assert.equal(typeof snapshot.platform,'string');
  assert.equal(typeof snapshot.hostname,'string');
  for(const item of snapshot.interfaces){
    assert.equal(Object.hasOwn(item,'mac'),false);
    assert.ok(['IPv4','IPv6'].includes(item.family));
  }
  const profile=observer.deviceProfile();
  assert.equal(profile.runtime,'electron-node');
  assert.ok(profile.adapters.includes('microphone'));

  const meter=createDataFlowMeter();
  meter.recordIn({hello:'world'});
  meter.recordOut('reply');
  const flow=meter.snapshot();
  assert.equal(flow.inEvents,1);
  assert.equal(flow.outEvents,1);
  assert.ok(flow.inBytes>0);
  assert.ok(flow.outBytes>0);
});
