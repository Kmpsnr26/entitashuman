import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let nonce=0;

async function createSiteRuntime(){
  delete globalThis.NeuralCore;
  delete globalThis.HumanALENaraRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?phase8='+ ++nonce);
  await import('../sites/humanale-hologram/dist/nara-runtime.js?phase8='+ ++nonce);
  const graph=globalThis.NeuralCore.create();
  return {graph,runtime:globalThis.HumanALENaraRuntime.create({regions:graph.regions})};
}

async function loadActivity(){
  delete globalThis.HumanALEActivity;
  await import('../sites/humanale-hologram/dist/nara-activity.js?phase8='+ ++nonce);
  return globalThis.HumanALEActivity;
}

test('cognitive activity stores bounded sanitized task agent and memory summaries only',async()=>{
  const {runtime}=await createSiteRuntime();
  const Activity=await loadActivity();
  const activity=Activity.create({runtime});
  activity.start();
  runtime.start();

  runtime.dispatch('work.start',{
    id:'phase8-task',
    label:'RAW PROMPT SHOULD NOT BE SAVED sk-proj-ABCDEFGHIJKLMNOP'
  });
  runtime.dispatch('agent.start',{
    agentId:'codex',mode:'work',taskId:'phase8-task',
    prompt:'TOP SECRET PROMPT',
    output:'TOP SECRET OUTPUT',
    token:'ghp_ABCDEFGHIJKLMNOP'
  });
  runtime.dispatch('memory.record',{
    kind:'episode',
    summary:'Selesai untuk private@example.test token=ghp_ABCDEFGHIJKLMNOP di C:\\Users\\Private\\repo',
    outcome:'complete',
    source:'agent',
    prompt:'DO NOT STORE PROMPT',
    output:'DO NOT STORE OUTPUT'
  });
  runtime.dispatch('agent.complete',{agentId:'codex',mode:'work',taskId:'phase8-task',durationMs:4321});
  runtime.dispatch('work.complete',{taskId:'phase8-task'});

  const snapshot=activity.snapshot();
  assert.equal(snapshot.currentTask,null);
  assert.equal(snapshot.tasks.at(-1).id,'phase8-task');
  assert.equal(snapshot.tasks.at(-1).label,'Task phase8-task');
  assert.equal(snapshot.tasks.at(-1).status,'complete');
  assert.equal(snapshot.agents.find(item=>item.id==='codex').status,'complete');
  assert.equal(snapshot.memory.length,1);
  assert.match(snapshot.memory[0].summary,/\[email\]/);
  assert.match(snapshot.memory[0].summary,/\[secret\]/);
  assert.match(snapshot.memory[0].summary,/\[path\]/);

  const serialized=JSON.stringify(snapshot);
  for(const forbidden of [
    'RAW PROMPT SHOULD NOT BE SAVED','TOP SECRET PROMPT','TOP SECRET OUTPUT',
    'DO NOT STORE PROMPT','DO NOT STORE OUTPUT','private@example.test',
    'ghp_ABCDEFGHIJKLMNOP','C:\\Users\\Private\\repo'
  ])assert.equal(serialized.includes(forbidden),false,forbidden);

  for(let i=0;i<80;i++)runtime.dispatch('memory.recall',{count:i,source:'test',prompt:'hidden-'+i});
  assert.ok(activity.snapshot().timeline.length<=48);
  activity.stop();
});

test('core BrainState maps planning reasoning agents and memory into real NARA regions',async()=>{
  const {createBrainState}=await import('../nara-core/brain/brain-state.js?phase8='+ ++nonce);
  const state=createBrainState();
  let id=0;
  const apply=(event,payload={})=>state.applyEvent({id:++id,event,payload,timestamp:Date.now()});

  apply('work.start',{id:'task-8',label:'Phase 8'});
  let snapshot=state.snapshot();
  assert.equal(snapshot.regions.PLANNER.status,'thinking');
  assert.equal(snapshot.regions.REASONER.status,'thinking');
  assert.equal(snapshot.regions.PROGRAM.status,'processing');

  apply('agent.start',{agentId:'codex',mode:'work',taskId:'task-8'});
  snapshot=state.snapshot();
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'processing');
  assert.equal(snapshot.regions.PLANNER.status,'thinking');

  apply('agent.complete',{agentId:'codex',mode:'work',taskId:'task-8'});
  apply('memory.record',{kind:'episode',summary:'Selesai',source:'agent'});
  snapshot=state.snapshot();
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'complete');
  assert.equal(snapshot.regions.MEMORY.status,'complete');

  apply('memory.recall',{count:2});
  snapshot=state.snapshot();
  assert.equal(snapshot.regions.MEMORY.status,'processing');

  apply('work.complete',{taskId:'task-8'});
  snapshot=state.snapshot();
  assert.equal(snapshot.regions.PLANNER.status,'complete');
  assert.equal(snapshot.regions.REASONER.status,'complete');
});

test('browser BrainState uses the same cognitive lifecycle semantics',async()=>{
  const {runtime}=await createSiteRuntime();
  runtime.start();
  runtime.dispatch('agent.start',{agentId:'codex',mode:'analyze',taskId:'t'});
  let snapshot=runtime.snapshot();
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'processing');
  assert.equal(snapshot.regions.REASONER.status,'thinking');
  runtime.dispatch('agent.error',{agentId:'codex',mode:'analyze',taskId:'t'});
  snapshot=runtime.snapshot();
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'error');
  assert.equal(snapshot.regions.ERROR_MONITOR.status,'error');
});

test('Desktop Agent Hub emits safe NARA lifecycle events without copying prompt or output into visual memory',async()=>{
  const main=await read('desktop/main.cjs');
  const start=main.indexOf("ipcMain.handle('dudidam:agent-run'");
  const end=main.indexOf("ipcMain.handle('dudidam:agent-open'",start);
  assert.ok(start>0&&end>start);
  const handler=main.slice(start,end);
  assert.match(handler,/const label='Agent '\+agentId\+' · '\+mode/);
  assert.match(handler,/nara\.dispatch\('planning\.start'/);
  assert.match(handler,/nara\.dispatch\('agent\.start'/);
  assert.match(handler,/nara\.dispatch\('agent\.complete'/);
  assert.match(handler,/nara\.dispatch\('agent\.error'/);
  assert.match(handler,/nara\.dispatch\('memory\.record'/);
  assert.match(handler,/summary:'Agent '\+agentId\+' menyelesaikan mode '\+mode/);
  assert.doesNotMatch(handler,/value\?\.prompt/);
  assert.doesNotMatch(handler,/result\.(?:text|output)|result\?\.(?:text|output)/);
});

test('Data Spine routes cognitive work and memory as event packets without raw payload storage',async()=>{
  const spine=await read('sites/humanale-hologram/dist/nara-data-spine.js');
  assert.match(spine,/'agent\.start':'CORE'/);
  assert.match(spine,/'agent\.complete':'CORE'/);
  assert.match(spine,/'memory\.record':'MEMORY'/);
  assert.match(spine,/event\.startsWith\('memory\.'\)\)return'\{\}'/);
  assert.doesNotMatch(spine,/payload\s*:/);
});

test('canonical HumanALE site exposes cognitive region controls and safe timeline rendering',async()=>{
  const [html,site,activity]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/nara-activity.js')
  ]);
  assert.match(html,/id="cognitiveTitle"/);
  assert.match(html,/id="cognitiveGrid"/);
  assert.match(html,/id="activityTimeline"/);
  assert.match(html,/data-cognitive-region="PLANNER"/);
  assert.match(html,/data-cognitive-region="REASONER"/);
  assert.match(html,/data-cognitive-region="AGENT_MANAGER"/);
  assert.match(html,/\.\/nara-activity\.js/);
  assert.match(site,/HumanALEActivity\.create/);
  assert.match(site,/activity\.start\(\)/);
  assert.match(site,/activity\.stop\(\)/);
  assert.match(site,/document\.createElement\('li'\)/);
  assert.match(site,/text\.textContent=/);
  assert.match(site,/replaceChildren/);
  assert.doesNotMatch(site,/activityTimeline\.innerHTML/);
  assert.match(activity,/BLOCKED_KEYS/);
  assert.match(activity,/'prompt','output','content','token','secret','password'/);
  assert.doesNotMatch(activity,/localStorage|sessionStorage|indexedDB|fetch\s*\(|WebSocket/);
});
