import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let nonce=0;

async function createRuntime(){
  delete globalThis.NeuralCore;
  delete globalThis.HumanALEAleRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?phase8='+ ++nonce);
  await import('../sites/humanale-hologram/dist/alecore-ai-runtime.js?phase8='+ ++nonce);
  const graph=globalThis.NeuralCore.create();
  const runtime=globalThis.HumanALEAleRuntime.create({regions:graph.regions});
  runtime.start();
  return {graph,runtime};
}

async function loadCognition(){
  delete globalThis.HumanALECognition;
  await import('../sites/humanale-hologram/dist/alecore-ai-cognition.js?phase8='+ ++nonce);
  return globalThis.HumanALECognition;
}

test('cognitive lifecycle events activate the expected AleCore AI regions',async()=>{
  const {runtime}=await createRuntime();

  runtime.dispatch('reason.start',{label:'Analisis permintaan'});
  let state=runtime.snapshot();
  assert.equal(state.regions.REASONER.status,'thinking');
  assert.equal(state.regions.REASONER.activity,1);

  runtime.dispatch('reason.complete');
  state=runtime.snapshot();
  assert.equal(state.regions.REASONER.status,'complete');

  runtime.dispatch('plan.start',{label:'Rencana kerja'});
  runtime.dispatch('agent.start',{label:'Agent codex · analisis'});
  runtime.dispatch('program.start',{label:'Menjalankan perubahan'});
  state=runtime.snapshot();
  assert.equal(state.regions.PLANNER.status,'processing');
  assert.equal(state.regions.AGENT_MANAGER.status,'processing');
  assert.equal(state.regions.PROGRAM.status,'processing');

  runtime.dispatch('verify.start');
  state=runtime.snapshot();
  assert.equal(state.regions.FOLLOW_UP.status,'processing');
  assert.equal(state.regions.REPORTING.status,'active');

  runtime.dispatch('memory.read',{label:'Memori kerja'});
  state=runtime.snapshot();
  assert.equal(state.regions.MEMORY.status,'active');

  runtime.dispatch('memory.complete');
  state=runtime.snapshot();
  assert.equal(state.regions.MEMORY.status,'complete');
});

test('cognitive ledger stores only sanitized operational metadata',async()=>{
  const {runtime}=await createRuntime();
  const Cognition=await loadCognition();
  const states=[];
  const cognition=Cognition.create({runtime,onState:state=>states.push(state),maxEntries:12});
  cognition.start();

  runtime.dispatch('work.start',{id:'task-1',label:'Uji aman',prompt:'PROMPT_SECRET',token:'TOKEN_SECRET'});
  runtime.dispatch('reason.start',{label:'Analisis ringkas',prompt:'HIDDEN_REASONING'});
  runtime.dispatch('reason.complete',{answer:'PRIVATE_RESULT'});
  runtime.dispatch('agent.start',{label:'Agent codex · analisis',payload:'PRIVATE_AGENT_DATA'});

  const snapshot=cognition.snapshot();
  assert.equal(snapshot.currentTask.id,'task-1');
  assert.equal(snapshot.currentTask.label,'Uji aman');
  assert.equal(snapshot.activeStage,'AGENT');
  assert.ok(snapshot.entries.length>=3);

  const serialized=JSON.stringify(snapshot);
  for(const forbidden of ['PROMPT_SECRET','TOKEN_SECRET','HIDDEN_REASONING','PRIVATE_RESULT','PRIVATE_AGENT_DATA']){
    assert.equal(serialized.includes(forbidden),false,forbidden);
  }
  assert.equal(Object.hasOwn(snapshot.entries.at(-1),'payload'),false);
  assert.equal(Object.hasOwn(snapshot.entries.at(-1),'prompt'),false);

  runtime.dispatch('work.failed',{id:'task-1',label:'Uji aman'});
  assert.equal(runtime.snapshot().currentTask,null);
  assert.equal(runtime.snapshot().regions.PROGRAM.status,'error');

  cognition.stop();
  assert.ok(states.length>0);
});

test('desktop real AI and coordinated agent paths emit AleCore AI cognitive lifecycle events without copying prompts into labels',async()=>{
  const [main,coordinator]=await Promise.all([
    read('desktop/main.cjs'),
    read('desktop/alecore-ai-agent-coordinator.mjs')
  ]);
  assert.match(main,/nara\.dispatch\('observe\.start'/);
  assert.match(main,/nara\.dispatch\('observe\.complete'/);
  assert.match(main,/nara\.dispatch\('reason\.start'/);
  assert.match(main,/nara\.dispatch\('reason\.complete'/);
  for(const event of [
    'plan.start','plan.complete','agent.start','agent.complete','agent.failed',
    'work.failed','program.start','program.complete','verify.start','verify.complete'
  ])assert.match(coordinator,new RegExp("this\\.nara\\.dispatch\\('"+event.replace('.','\\.')+"'"));
  assert.match(coordinator,/const label='Agent '\+meta\.id\+' · '/);
  assert.match(main,/aleAgentCoordinator\.run\(\{\.\.\.value,memoryContext\}\)/);
  assert.doesNotMatch(main,/reason\.start'\s*,\s*\{label\s*:\s*String\(value\?\.prompt/);
  assert.doesNotMatch(coordinator,/label\s*:\s*meta\.prompt/);
});

test('canonical site loads cognition module and renders only stage/task/status metadata',async()=>{
  const [html,site,cognition]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/alecore-ai-cognition.js')
  ]);
  assert.match(html,/\.\/alecore-ai-cognition\.js/);
  assert.match(html,/id="cognitionStage"/);
  assert.match(html,/id="cognitionTask"/);
  assert.match(html,/id="cognitionTimeline"/);
  assert.match(html,/NO CHAIN-OF-THOUGHT/);
  assert.match(site,/HumanALECognition\.create/);
  assert.match(site,/cognition\.start\(\)/);
  assert.match(site,/cognition\.stop\(\)/);
  assert.match(site,/data-cognition-region/);
  assert.doesNotMatch(cognition,/OPENAI_API_KEY|GITHUB_TOKEN|process\.env|password|chainOfThought|reasoning_text/i);
  assert.match(cognition,/const entry=Object\.freeze\(\{/);
  assert.doesNotMatch(cognition,/entry\s*=\s*Object\.freeze\(\{[\s\S]{0,700}(?:prompt|token|secret|reasoning)/i);
});

test('Data Spine routes cognition events to bounded safe lanes',async()=>{
  const spine=await read('sites/humanale-hologram/dist/alecore-ai-data-spine.js');
  for(const event of [
    'observe.start','reason.start','plan.start','agent.start',
    'program.start','memory.read','verify.start'
  ])assert.match(spine,new RegExp("'"+event.replace('.','\\.')+"'"));
  assert.match(spine,/'memory\.read':'MEMORY'/);
  assert.match(spine,/'agent\.failed':'ERROR'/);
});

test('core BrainState mirrors the browser cognitive event model',async()=>{
  const {createBrainState}=await import('../ALECORE-AI/brain/brain-state.js?phase8='+ ++nonce);
  const state=createBrainState();
  state.applyEvent({id:1,event:'reason.start',timestamp:1,payload:{label:'Analisis'}});
  state.applyEvent({id:2,event:'plan.start',timestamp:2,payload:{label:'Rencana'}});
  state.applyEvent({id:3,event:'agent.start',timestamp:3,payload:{label:'Agent'}});
  state.applyEvent({id:4,event:'program.start',timestamp:4,payload:{label:'Program'}});
  const snapshot=state.snapshot();
  assert.equal(snapshot.regions.REASONER.status,'thinking');
  assert.equal(snapshot.regions.PLANNER.status,'processing');
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'processing');
  assert.equal(snapshot.regions.PROGRAM.status,'processing');
});
