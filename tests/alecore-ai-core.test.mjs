import test from 'node:test';
import assert from 'node:assert/strict';
import {ALECORE_AI_REGION_IDS,ALECORE_AI_REGIONS,isRegionId} from '../ALECORE-AI/brain/regions.js';
import {createEventBus} from '../ALECORE-AI/brain/event-bus.js';
import {createBrainState} from '../ALECORE-AI/brain/brain-state.js';
import {createOrchestrator} from '../ALECORE-AI/brain/orchestrator.js';
import {ALECORE_AI_SKILL_IDS,ALECORE_AI_SKILLS,isSkillId,createSkillSnapshot,skillTestScenario,validateSkillDependencyGraph} from '../ALECORE-AI/brain/skill-registry.js';

test('AleCore AI brain exposes the required Phase 1 regions with 3D positions',()=>{
  const required=['ALECORE_AI','REASONER','PLANNER','MEMORY','BUG_HUNTER','AGENT_MANAGER','TOOLS','TERMINAL','GITHUB','COPILOT','WEB','TEAM','PR','SYNC','ONLINE','SAFETY','OWNER_EMAIL','DRIVE','REPORTING','FOLLOW_UP','PROGRAM','ERROR_MONITOR'];
  for(const id of required){
    assert.ok(ALECORE_AI_REGION_IDS.includes(id),id+' missing');
    assert.equal(isRegionId(id),true);
    for(const axis of ['x','y','z'])assert.equal(Number.isFinite(ALECORE_AI_REGIONS[id].position[axis]),true,id+' '+axis);
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
  ale.start();
  ale.selectRegion('MEMORY');
  assert.equal(ale.snapshot().selectedRegion,'MEMORY');
  ale.connection('github',true);
  assert.equal(ale.snapshot().regions.GITHUB.status,'connected');
  ale.connection('github',false);
  assert.equal(ale.snapshot().regions.GITHUB.status,'disconnected');
  assert.equal(ale.bus.recent({event:'github.disconnected',limit:1}).length,1);
  ale.startWork({id:'phase-1',label:'Bangun AleCore AI'});
  assert.equal(ale.snapshot().regions.PROGRAM.status,'processing');
  ale.completeWork();
  assert.equal(ale.snapshot().regions.REPORTING.status,'active');
  ale.stop();
  assert.equal(ale.snapshot().lifecycle,'offline');
  assert.equal(ale.snapshot().regions.ALECORE_AI.status,'offline');
});


test('AleCore AI owns HumanALE state and renderer policy',()=>{
  const nara=createOrchestrator();
  ale.start();
  assert.equal(ale.snapshot().humanale.controlledBy,'ALECORE_AI');
  assert.equal(ale.snapshot().humanale.state,'idle');
  assert.equal(ale.snapshot().humanale.rendererMode,'eco');

  ale.dispatch('hearing.start');
  assert.equal(ale.snapshot().humanale.state,'listening');
  assert.equal(ale.snapshot().humanale.rendererMode,'active');

  ale.dispatch('hearing.stop');
  assert.equal(ale.snapshot().humanale.state,'idle');
  assert.equal(ale.snapshot().humanale.rendererMode,'eco');

  ale.dispatch('reason.start',{label:'Analisis'});
  assert.equal(ale.snapshot().humanale.state,'thinking');
  assert.equal(ale.snapshot().humanale.rendererMode,'active');

  ale.dispatch('reason.complete');
  assert.equal(ale.snapshot().humanale.state,'idle');

  ale.startWork({id:'phase-4',label:'Sinkronisasi HumanALE'});
  assert.equal(ale.snapshot().humanale.state,'processing');
  assert.equal(ale.snapshot().humanale.rendererMode,'balanced');

  ale.completeWork();
  assert.equal(ale.snapshot().humanale.state,'idle');
  assert.equal(ale.snapshot().humanale.rendererMode,'eco');

  ale.dispatch('error.detected',{message:'Test error'});
  assert.equal(ale.snapshot().humanale.state,'error');
  assert.equal(ale.snapshot().humanale.rendererMode,'active');
});


test('AleCore AI skill registry exposes bounded capabilities, dependencies and permissions',()=>{
  const required=['hearing','voice','vision','memory','reasoning','planner','agents','terminal','program','bug-hunter','web','github','copilot','drive','reporting','safety'];
  assert.deepEqual(ALECORE_AI_SKILL_IDS,required);
  for(const id of required){
    assert.equal(isSkillId(id),true);
    assert.ok(ALECORE_AI_SKILLS[id].region);
    assert.ok(Array.isArray(ALECORE_AI_SKILLS[id].dependencies));
    assert.ok(Array.isArray(ALECORE_AI_SKILLS[id].permissions));
  }
  for(const key of ['__proto__','constructor','prototype'])assert.equal(isSkillId(key),false);
  assert.equal(skillTestScenario('reasoning'),'thinking');
  assert.equal(skillTestScenario('terminal'),null);
});

test('AleCore AI skill snapshot derives runtime health and blocks unhealthy dependencies',()=>{
  const nara=createOrchestrator();
  ale.start();
  let snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.controlledBy,'ALECORE_AI');
  assert.equal(snapshot.skills.hearing.state,'ready');
  assert.equal(snapshot.skills.voice.state,'ready');
  assert.equal(snapshot.skills.vision.state,'ready');
  assert.equal(snapshot.skills.terminal.state,'ready');
  assert.equal(snapshot.skills.agents.state,'setup');

  ale.dispatch('hearing.start');
  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills.hearing.state,'running');
  assert.equal(snapshot.skills.voice.state,'ready');
  ale.dispatch('hearing.stop');

  ale.dispatch('speech.start',{energy:.6});
  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills.voice.state,'running');
  ale.dispatch('speech.stop');

  ale.dispatch('vision.frame',{activity:.8,frameId:'skill-test'});
  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills.vision.state,'running');
  ale.dispatch('vision.stop');

  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills.hearing.state,'ready');
  assert.equal(snapshot.skills.voice.state,'ready');
  assert.equal(snapshot.skills.vision.state,'ready');

  ale.dispatch('github.disconnected');
  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills.github.state,'offline');

  ale.dispatch('error.detected',{message:'Synthetic registry test'});
  snapshot=createSkillSnapshot({brainState:ale.snapshot(),agents:[]});
  assert.equal(snapshot.skills['bug-hunter'].state,'running');
  assert.ok(snapshot.counts.total===ALECORE_AI_SKILL_IDS.length);
});


test('AleCore AI skill dependency graph is acyclic and all dependencies are known',()=>{
  const result=validateSkillDependencyGraph();
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.cycle,[]);
  assert.deepEqual(ALECORE_AI_SKILLS.program.dependencies,['terminal','safety']);
  assert.deepEqual(ALECORE_AI_SKILLS['bug-hunter'].dependencies,['reasoning','terminal']);
});
