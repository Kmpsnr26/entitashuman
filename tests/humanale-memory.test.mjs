import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let nonce=0;

async function createRuntime(){
  delete globalThis.NeuralCore;
  delete globalThis.HumanALEAleRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?phase9='+ ++nonce);
  await import('../sites/humanale-hologram/dist/alecore-ai-runtime.js?phase9='+ ++nonce);
  const graph=globalThis.NeuralCore.create();
  const runtime=globalThis.HumanALEAleRuntime.create({regions:graph.regions});
  runtime.start();
  return {graph,runtime};
}

async function loadMemory(){
  delete globalThis.HumanALEMemory;
  await import('../sites/humanale-hologram/dist/alecore-ai-memory.js?phase9='+ ++nonce);
  return globalThis.HumanALEMemory;
}

function fakeStorage(){
  const data=new Map();
  return {
    getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    removeItem:key=>data.delete(key),
    dump:()=>Object.fromEntries(data)
  };
}

test('persistent AleCore AI memory survives reload and recalls relevant project context',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const storage=fakeStorage();
  let clock=1000;

  const memory=Memory.create({runtime,storage,now:()=>++clock,maxEntries:20});
  const saved=memory.remember({
    type:'project',
    title:'HumanALE Phase 9',
    summary:'Gunakan avatar canonical dan pertahankan reference face.',
    tags:['humanale','avatar'],
    source:'manual'
  });
  assert.ok(saved.id);
  assert.equal(memory.snapshot().count,1);
  assert.equal(memory.snapshot().persistent,true);

  const results=memory.recall('avatar',{limit:5});
  assert.equal(results.length,1);
  assert.equal(results[0].title,'HumanALE Phase 9');

  const context=memory.context('humanale',{limit:4,maxChars:400});
  assert.equal(context.count,1);
  assert.match(context.text,/HumanALE Phase 9/);
  assert.ok(context.text.length<=400);

  const reloaded=Memory.create({runtime,storage,now:()=>++clock,maxEntries:20});
  assert.equal(reloaded.snapshot().count,1);
  assert.equal(reloaded.snapshot().entries[0].title,'HumanALE Phase 9');
});

test('memory redacts recognized credentials and never persists raw prompt payloads',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const storage=fakeStorage();
  const memory=Memory.create({runtime,storage,maxEntries:20});

  memory.remember({
    type:'note',
    title:'Credential test sk-proj-ABCDEFGHIJKLMNOP123456',
    summary:'password=supersecret123 api_key=abcdef123456789 Bearer ABCDEFGHIJKLMNOPQRST',
    tags:['security']
  });

  memory.start();
  runtime.dispatch('work.start',{
    id:'task-private',
    label:'Build secure panel sk-proj-ZYXWVUTSRQPONMLK987654',
    prompt:'THIS_PROMPT_MUST_NEVER_PERSIST',
    token:'RAW_TOKEN_MUST_NOT_PERSIST'
  });
  runtime.dispatch('work.complete',{
    answer:'PRIVATE_ANSWER_MUST_NOT_PERSIST'
  });

  const serialized=JSON.stringify(memory.snapshot())+JSON.stringify(storage.dump());
  for(const forbidden of [
    'ABCDEFGHIJKLMNOP123456',
    'supersecret123',
    'abcdef123456789',
    'ABCDEFGHIJKLMNOPQRST',
    'ZYXWVUTSRQPONMLK987654',
    'THIS_PROMPT_MUST_NEVER_PERSIST',
    'RAW_TOKEN_MUST_NOT_PERSIST',
    'PRIVATE_ANSWER_MUST_NOT_PERSIST'
  ])assert.equal(serialized.includes(forbidden),false,forbidden);
  assert.match(serialized,/\[REDACTED\]/);
  assert.equal(memory.snapshot().count,2);
  assert.equal(runtime.snapshot().regions.MEMORY.status,'complete');
});

test('automatic task memory is operational metadata only and closes failed tasks',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const storage=fakeStorage();
  const memory=Memory.create({runtime,storage,maxEntries:20});
  memory.start();

  runtime.dispatch('work.start',{id:'agent-1',label:'Agent codex · mode kerja'});
  runtime.dispatch('work.complete',{source:'agent'});
  let snapshot=memory.snapshot();
  assert.equal(snapshot.count,1);
  assert.equal(snapshot.entries[0].type,'task');
  assert.equal(snapshot.entries[0].title,'Agent codex · mode kerja');
  assert.deepEqual(snapshot.entries[0].tags,['task','complete']);

  runtime.dispatch('work.start',{id:'agent-2',label:'Agent copilot · mode kerja'});
  runtime.dispatch('work.failed',{source:'agent'});
  snapshot=memory.snapshot();
  assert.equal(snapshot.count,2);
  assert.equal(snapshot.entries[1].type,'result');
  assert.deepEqual(snapshot.entries[1].tags,['task','failed']);
  assert.equal(runtime.snapshot().currentTask,null);
});

test('memory remains bounded and supports forget and clear',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const storage=fakeStorage();
  let clock=5000;
  const memory=Memory.create({runtime,storage,maxEntries:10,now:()=>++clock});

  for(let i=0;i<15;i++)memory.remember({
    type:'note',title:'Note '+i,summary:'Summary '+i,tags:['test']
  },{emit:false});
  assert.equal(memory.snapshot().count,10);
  assert.equal(memory.snapshot().entries[0].title,'Note 5');

  const id=memory.snapshot().entries[3].id;
  assert.equal(memory.forget(id),true);
  assert.equal(memory.snapshot().count,9);
  assert.equal(memory.forget('does-not-exist'),false);

  memory.clear();
  assert.equal(memory.snapshot().count,0);
  assert.equal(storage.getItem(Memory.key),null);
});

test('storage failure falls back to session memory without crashing',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const errors=[];
  const broken={
    getItem(){return null;},
    setItem(){throw new Error('quota blocked');},
    removeItem(){throw new Error('remove blocked');}
  };
  const memory=Memory.create({runtime,storage:broken,onError:error=>errors.push(error)});
  const saved=memory.remember({type:'note',title:'Session note',summary:'Still available this session.'});
  assert.ok(saved);
  assert.equal(memory.snapshot().count,1);
  assert.equal(memory.snapshot().persistent,false);
  assert.ok(errors.some(error=>error.type==='persist'));
});

test('memory context is bounded and only contains sanitized entry fields',async()=>{
  const {runtime}=await createRuntime();
  const Memory=await loadMemory();
  const memory=Memory.create({runtime,storage:fakeStorage(),maxEntries:20});
  for(let i=0;i<8;i++)memory.remember({
    type:'note',
    title:'Project decision '+i,
    summary:'A'.repeat(250)+' sk-proj-SECRETSECRETSECRET'+i,
    tags:['project','decision']
  },{emit:false});
  const context=memory.context('project',{limit:8,maxChars:320});
  assert.ok(context.text.length<=320);
  assert.equal(context.text.includes('SECRETSECRETSECRET'),false);
  for(const entry of context.entries){
    assert.deepEqual(Object.keys(entry).sort(),['createdAt','id','source','summary','tags','title','type','updatedAt'].sort());
  }
});

test('canonical HumanALE site wires persistent memory controls and lifecycle',async()=>{
  const [html,site,memory]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/alecore-ai-memory.js')
  ]);
  assert.match(html,/\.\/alecore-ai-memory\.js/);
  assert.match(html,/id="memoryForm"/);
  assert.match(html,/id="memorySearch"/);
  assert.match(html,/id="memoryList"/);
  assert.match(html,/id="memoryClear"/);
  assert.match(site,/HumanALEMemory\.create/);
  assert.match(site,/memory\.start\(\)/);
  assert.match(site,/memory\.stop\(\)/);
  assert.match(site,/memory\.remember\(/);
  assert.match(site,/memory\.recall\(/);
  assert.match(site,/memory\.forget\(/);
  assert.match(site,/memory\.clear\(\)/);
  assert.match(site,/window\.confirm\(/);
  assert.doesNotMatch(memory,/fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon/);
});

test('Data Spine continues to route real memory lifecycle events',async()=>{
  const spine=await read('sites/humanale-hologram/dist/alecore-ai-data-spine.js');
  assert.match(spine,/'memory\.read':'MEMORY'/);
  assert.match(spine,/'memory\.write':'MEMORY'/);
  assert.match(spine,/'memory\.complete':'MEMORY'/);
});
