import test from 'node:test';
import assert from 'node:assert/strict';
import {NARA_REGION_IDS,NARA_REGIONS,isRegionId} from '../nara-core/brain/regions.js';
import {createEventBus} from '../nara-core/brain/event-bus.js';
import {createBrainState} from '../nara-core/brain/brain-state.js';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';

test('NARA brain exposes the required Phase 1 regions with 3D positions',()=>{
  const required=['NARA_CORE','REASONER','PLANNER','MEMORY','BUG_HUNTER','AGENT_MANAGER','TOOLS','TERMINAL','GITHUB','COPILOT','WEB','TEAM','PR','SYNC','ONLINE','SAFETY','OWNER_EMAIL','DRIVE','REPORTING','FOLLOW_UP','PROGRAM','ERROR_MONITOR'];
  for(const id of required){
    assert.ok(NARA_REGION_IDS.includes(id),id+' missing');
    assert.equal(isRegionId(id),true);
    for(const axis of ['x','y','z'])assert.equal(Number.isFinite(NARA_REGIONS[id].position[axis]),true,id+' '+axis);
  }
});

test('event bus preserves ordered bounded history and supports once listeners',()=>{
  const bus=createEventBus({historyLimit:10});
  let onceCount=0;
  bus.once('work.start',()=>onceCount++);
  bus.emit('work.start',{id:'a'});
  bus.emit('work.start',{id:'b'});
  for(let i=0;i<20;i++)bus.emit('tick',{i});
  assert.equal(onceCount,1);
  assert.equal(bus.recent({limit:50}).length,10);
  assert.deepEqual(bus.recent({event:'work.start'}),[]);
});

test('brain state maps operational, connection and sensory events into live state',()=>{
  const state=createBrainState();
  let id=0;
  const apply=(event,payload={})=>state.applyEvent({id:++id,event,payload,timestamp:Date.now()});
  apply('github.connected');
  apply('login.required',{region:'DRIVE'});
  apply('bug.detected',{message:'Renderer failure'});
  apply('audio.energy',{energy:.8,low:.2,mid:.7,high:.4});
  apply('vision.frame',{activity:.6,frameId:'frame-1'});
  apply('speech.start',{energy:.5});
  const snapshot=state.snapshot();
  assert.equal(snapshot.regions.GITHUB.status,'connected');
  assert.equal(snapshot.regions.DRIVE.status,'login_required');
  assert.equal(snapshot.regions.BUG_HUNTER.status,'bug');
  assert.equal(snapshot.sensory.hearing.energy,.8);
  assert.equal(snapshot.sensory.vision.frameId,'frame-1');
  assert.equal(snapshot.sensory.speech.active,true);
});

test('orchestrator drives selection, work lifecycle and connection changes through the shared bus',()=>{
  const nara=createOrchestrator();
  nara.start();
  nara.selectRegion('MEMORY');
  assert.equal(nara.snapshot().selectedRegion,'MEMORY');
  nara.connection('github',true);
  assert.equal(nara.snapshot().regions.GITHUB.status,'connected');
  nara.connection('github',false);
  assert.equal(nara.snapshot().regions.GITHUB.status,'disconnected');
  assert.equal(nara.bus.recent({event:'github.disconnected',limit:1}).length,1);
  nara.startWork({id:'phase-1',label:'Bangun NARA Core'});
  assert.equal(nara.snapshot().regions.PROGRAM.status,'processing');
  nara.completeWork();
  assert.equal(nara.snapshot().regions.REPORTING.status,'active');
  nara.stop();
  assert.equal(nara.snapshot().lifecycle,'offline');
  assert.equal(nara.snapshot().regions.NARA_CORE.status,'offline');
});


test('brain state records provider readiness and bounded autopilot status',()=>{
  const nara=createOrchestrator();
  nara.start();
  nara.dispatch('provider.status',{id:'gemini',attached:true,configured:true,ready:true,mode:'gemini-api',model:'gemini-test'});
  nara.dispatch('provider.status',{id:'copilot',attached:true,configured:true,ready:true,mode:'copilot-cli'});
  nara.dispatch('autopilot.status',{ready:true,armed:true,mode:'bounded',projectRootReady:true,executors:['codex','github-copilot'],detail:'ready'});
  const state=nara.snapshot();
  assert.equal(state.providers.gemini.ready,true);
  assert.equal(state.providers.copilot.ready,true);
  assert.equal(state.autopilot.ready,true);
  assert.equal(state.autopilot.armed,true);
  assert.deepEqual(state.autopilot.executors,['codex','github-copilot']);
  assert.equal(state.regions.COPILOT.status,'connected');
  assert.equal(state.regions.AGENT_MANAGER.status,'ready');
  nara.stop();
});
