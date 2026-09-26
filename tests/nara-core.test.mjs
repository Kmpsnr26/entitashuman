import test from 'node:test';
import assert from 'node:assert/strict';
import {NARA_REGION_IDS,NARA_REGIONS,isRegionId} from '../nara-core/brain/regions.js';
import {createEventBus} from '../nara-core/brain/event-bus.js';
import {createBrainState} from '../nara-core/brain/brain-state.js';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {NARA_SKILL_IDS,NARA_SKILLS,isSkillId,createSkillSnapshot,skillTestScenario} from '../nara-core/brain/skill-registry.js';

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


test('NARA Core owns HumanALE state and renderer policy',()=>{
  const nara=createOrchestrator();
  nara.start();
  assert.equal(nara.snapshot().humanale.controlledBy,'NARA_CORE');
  assert.equal(nara.snapshot().humanale.state,'idle');
  assert.equal(nara.snapshot().humanale.rendererMode,'eco');

  nara.dispatch('hearing.start');
  assert.equal(nara.snapshot().humanale.state,'listening');
  assert.equal(nara.snapshot().humanale.rendererMode,'active');

  nara.dispatch('hearing.stop');
  assert.equal(nara.snapshot().humanale.state,'idle');
  assert.equal(nara.snapshot().humanale.rendererMode,'eco');

  nara.dispatch('reason.start',{label:'Analisis'});
  assert.equal(nara.snapshot().humanale.state,'thinking');
  assert.equal(nara.snapshot().humanale.rendererMode,'active');

  nara.dispatch('reason.complete');
  assert.equal(nara.snapshot().humanale.state,'idle');

  nara.startWork({id:'phase-4',label:'Sinkronisasi HumanALE'});
  assert.equal(nara.snapshot().humanale.state,'processing');
  assert.equal(nara.snapshot().humanale.rendererMode,'balanced');

  nara.completeWork();
  assert.equal(nara.snapshot().humanale.state,'idle');
  assert.equal(nara.snapshot().humanale.rendererMode,'eco');

  nara.dispatch('error.detected',{message:'Test error'});
  assert.equal(nara.snapshot().humanale.state,'error');
  assert.equal(nara.snapshot().humanale.rendererMode,'active');
});


test('NARA skill registry exposes bounded capabilities, dependencies and permissions',()=>{
  const required=['hearing','voice','vision','memory','reasoning','planner','agents','terminal','program','bug-hunter','web','github','copilot','drive','reporting','safety'];
  assert.deepEqual(NARA_SKILL_IDS,required);
  for(const id of required){
    assert.equal(isSkillId(id),true);
    assert.ok(NARA_SKILLS[id].region);
    assert.ok(Array.isArray(NARA_SKILLS[id].dependencies));
    assert.ok(Array.isArray(NARA_SKILLS[id].permissions));
  }
  for(const key of ['__proto__','constructor','prototype'])assert.equal(isSkillId(key),false);
  assert.equal(skillTestScenario('reasoning'),'thinking');
  assert.equal(skillTestScenario('terminal'),null);
});

test('NARA skill snapshot derives runtime health and blocks unhealthy dependencies',()=>{
  const nara=createOrchestrator();
  nara.start();
  let snapshot=createSkillSnapshot({brainState:nara.snapshot(),agents:[]});
  assert.equal(snapshot.controlledBy,'NARA_CORE');
  assert.equal(snapshot.skills.hearing.state,'ready');
  assert.equal(snapshot.skills.terminal.state,'ready');
  assert.equal(snapshot.skills.agents.state,'setup');

  nara.dispatch('github.disconnected');
  snapshot=createSkillSnapshot({brainState:nara.snapshot(),agents:[]});
  assert.equal(snapshot.skills.github.state,'offline');

  nara.dispatch('error.detected',{message:'Synthetic registry test'});
  snapshot=createSkillSnapshot({brainState:nara.snapshot(),agents:[]});
  assert.equal(snapshot.skills['bug-hunter'].state,'running');
  assert.ok(snapshot.counts.total===NARA_SKILL_IDS.length);
});
