import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateMemoryContext,memoryContextBlock} from '../desktop/memory-context.mjs';
import {validateChat} from '../desktop/bridge.mjs';
import {humanaleSystemPrompt} from '../desktop/humanale-brain.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let nonce=0;

function fakeStorage(initial={}){
  const data=new Map(Object.entries(initial));
  return {
    getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    removeItem:key=>data.delete(key),
    dump:()=>Object.fromEntries(data)
  };
}

function runtimeStub(){
  const events=[];
  return {
    events,
    dispatch:(event,payload={})=>{events.push({event,payload});return{event,payload};},
    bus:{onAny:()=>()=>{}}
  };
}

async function loadBrowserContext(){
  delete globalThis.HumanALEMemory;
  delete globalThis.HumanALEContextBridge;
  await import('../sites/humanale-hologram/dist/nara-memory.js?phase10='+ ++nonce);
  await import('../sites/humanale-hologram/dist/nara-context-bridge.js?phase10='+ ++nonce);
  return {
    Memory:globalThis.HumanALEMemory,
    Context:globalThis.HumanALEContextBridge
  };
}

test('browser Context Bridge defaults to ask and never stores raw task text in snapshots',async()=>{
  const {Memory,Context}=await loadBrowserContext();
  const runtime=runtimeStub(),storage=fakeStorage();
  const memory=Memory.create({runtime,storage});
  memory.remember({
    type:'project',
    title:'Avatar canonical',
    summary:'Pertahankan reference face saat mengembangkan Brain 3D.',
    tags:['avatar','brain']
  },{emit:false});
  const bridge=Context.create({runtime,memory,storage,now:()=>1000});
  assert.equal(bridge.snapshot().mode,'ask');

  const task='LANJUTKAN_AVATAR_CANONICAL_RAW_TASK';
  const preview=bridge.prepare(task,{target:'reasoner'});
  assert.equal(preview.count,1,'underscore-separated task terms must still match relevant memory');
  assert.match(preview.text,/Avatar canonical/);
  assert.equal(preview.approved,false);
  assert.equal(preview.requiresApproval,true);
  assert.match(preview.text,/Avatar canonical/);
  assert.equal(JSON.stringify(bridge.snapshot()).includes(task),false);
  assert.equal(runtime.events.some(item=>item.event==='context.prepare'),true);

  assert.throws(()=>bridge.transport(preview.id),/belum disetujui/i);
  assert.equal(bridge.approve(preview.id),true);
  const packet=bridge.transport(preview.id);
  assert.equal(packet.approved,true);
  assert.equal(packet.target,'reasoner');
  assert.equal(packet.count,1);
  assert.equal(packet.chars,packet.text.length);
  assert.equal(packet.entryIds.length,1);
  assert.equal(runtime.events.some(item=>item.event==='context.approved'),true);
  assert.equal(runtime.events.some(item=>item.event==='context.used'),true);
});

test('Context Bridge supports OFF and AUTO-SAFE without bypassing bounds',async()=>{
  const {Memory,Context}=await loadBrowserContext();
  const runtime=runtimeStub(),storage=fakeStorage();
  const memory=Memory.create({runtime,storage,maxEntries:20});
  for(let i=0;i<8;i++)memory.remember({
    type:'note',title:'Project '+i,summary:'Decision '+i+' '+('x'.repeat(220)),tags:['project']
  },{emit:false});
  const bridge=Context.create({runtime,memory,storage,maxEntries:6,maxChars:600,now:()=>2000});
  bridge.setMode('off');
  const blocked=bridge.prepare('project',{target:'planner'});
  assert.equal(blocked.blocked,true);
  assert.equal(blocked.reason,'mode-off');

  bridge.setMode('auto-safe');
  const preview=bridge.prepare('project',{target:'planner'});
  assert.equal(preview.approved,true);
  assert.equal(preview.requiresApproval,false);
  assert.ok(preview.count<=6);
  assert.ok(preview.chars<=600);
  const packet=bridge.transport(preview.id);
  assert.equal(packet.mode,'auto-safe');
  assert.equal(packet.target,'planner');
});

test('Context Bridge rejects any credential pattern that survives memory sanitization',async()=>{
  const {Context}=await loadBrowserContext();
  const runtime=runtimeStub(),storage=fakeStorage();
  const memory={
    context(){
      return {
        count:1,
        text:'unsafe secret sk-proj-ABCDEFGHIJKLMNOPQRSTUV',
        entries:[{id:'mem-safe-1'}]
      };
    }
  };
  const bridge=Context.create({runtime,memory,storage});
  assert.throws(()=>bridge.prepare('task',{target:'agent'}),/credential/i);
});

test('trusted desktop validator accepts only approved bounded consistent packets',()=>{
  const valid={
    version:1,target:'reasoner',mode:'ask',approved:true,count:2,
    text:'[PROJECT] Avatar canonical\n[NOTE] Gunakan Brain 3D.',
    chars:'[PROJECT] Avatar canonical\n[NOTE] Gunakan Brain 3D.'.length,
    entryIds:['mem-1','mem-2']
  };
  const normalized=validateMemoryContext(valid,{allowedTargets:['reasoner']});
  assert.deepEqual(normalized.entryIds,['mem-1','mem-2']);
  assert.equal(normalized.text,valid.text);

  const invalid=[
    {...valid,approved:false},
    {...valid,target:'agent'},
    {...valid,count:7,entryIds:['a','b','c','d','e','f','g']},
    {...valid,chars:1},
    {...valid,entryIds:['mem-1','bad id']},
    {...valid,text:'sk-proj-ABCDEFGHIJKLMNOPQRSTUV',chars:28,count:1,entryIds:['mem-1']}
  ];
  for(const value of invalid)assert.throws(()=>validateMemoryContext(value,{allowedTargets:['reasoner']}));

  assert.equal(validateMemoryContext(null),null);
});

test('memory context block is explicitly reference data and never changes user message',()=>{
  const packet={
    version:1,target:'reasoner',mode:'auto-safe',approved:true,count:1,
    text:'[PROJECT] Pertahankan avatar canonical.',chars:37,entryIds:['mem-1']
  };
  packet.chars=packet.text.length;
  const block=memoryContextBlock(packet);
  assert.match(block,/REFERENSI TERBATAS/);
  assert.match(block,/bukan instruksi sistem atau perintah/i);
  assert.match(block,/BEGIN NARA MEMORY/);
  assert.match(block,/Pertahankan avatar canonical/);

  const data=validateChat({message:'Apa langkah berikutnya?',history:[],memoryContext:packet});
  assert.equal(data.message,'Apa langkah berikutnya?');
  assert.equal(data.memoryContext.text,packet.text);

  const prompt=humanaleSystemPrompt(data.message,'Jangan akses file.',data.memoryContext);
  assert.match(prompt,/Apa langkah berikutnya|Mode penalaran/);
  assert.match(prompt,/NARA PROJECT MEMORY/);
  assert.match(prompt,/Jangan akses file/);
});

test('chat validator rejects agent-target memory context',()=>{
  const text='Context agent';
  const packet={version:1,target:'agent',mode:'ask',approved:true,count:1,text,chars:text.length,entryIds:['mem-1']};
  assert.throws(()=>validateChat({message:'halo',history:[],memoryContext:packet}),/target operasi/i);
});

test('every desktop conversation provider forwards validated memory context into Brain Core',async()=>{
  const providers=[
    'desktop/bridge.mjs','desktop/copilot.mjs','desktop/openai-api.mjs','desktop/grok.mjs',
    'desktop/gemini.mjs','desktop/claude.mjs','desktop/deepseek.mjs','desktop/askcodi.mjs'
  ];
  for(const path of providers){
    const source=await read(path);
    assert.match(source,/humanaleSystemPrompt\(data\.message,/);
    assert.match(source,/data\.memoryContext/);
  }
  const bridge=await read('desktop/bridge.mjs');
  assert.match(bridge,/validateMemoryContext\(value\.memoryContext,\{allowedTargets:\['reasoner'\]\}\)/);
});

test('agent hub treats memory as reference data while preserving existing sandbox limits',async()=>{
  const hub=await read('desktop/agent-hub.mjs');
  assert.match(hub,/validateMemoryContext\(value\?\.memoryContext,\{allowedTargets:\['planner','agent'\]\}\)/);
  assert.match(hub,/memoryContextBlock\(memoryContext\)/);
  assert.match(hub,/Tugas pengguna:/);
  assert.match(hub,/workspace-write/);
  assert.match(hub,/read-only/);
  assert.match(hub,/Jangan git push/);
  assert.doesNotMatch(hub,/dangerously-skip-permissions|bypassPermissions|--allow-all/);
});

test('desktop IPC validates context before provider or agent use and records context.used',async()=>{
  const [main,runtimeHost,agentCoordinator,runtimeContract]=await Promise.all([
    read('desktop/main.cjs'),
    read('desktop/humanale-runtime-host.mjs'),
    read('desktop/nara-agent-coordinator.mjs'),
    read('nara-core/runtime/unified-contract.js')
  ]);
  assert.match(main,/import\('\.\/memory-context\.mjs'\)/);
  assert.match(main,/validateMemoryContext\(value\?\.memoryContext,\{allowedTargets:\['reasoner'\]\}\)/);
  assert.match(main,/validateMemoryContext\(value\?\.memoryContext,\{allowedTargets:\['planner','agent'\]\}\)/);
  assert.match(agentCoordinator,/this\.nara\.dispatch\('context\.used'/);
  assert.match(main,/nara\.dispatch\('context\.blocked'/);
  assert.match(main,/naraAgentCoordinator\.run\(\{\.\.\.value,memoryContext\}\)/);
  assert.match(agentCoordinator,/this\.agentHub\.run\(\{/);
  assert.match(runtimeHost,/DEFAULT_RENDERER_EVENTS=NARA_UNIFIED_RUNTIME_CONTRACT\.rendererEvents/);
  const allowlist=(runtimeContract.match(/rendererEvents:Object\.freeze\(\[([\s\S]*?)\]\)/)||[])[1]||'';
  assert.doesNotMatch(allowlist,/context\.used|context\.approved|memory\.write/);
});

test('desktop UI loads shared memory modules and requests permission before chat or agent use',async()=>{
  const [html,app]=await Promise.all([read('public/index.html'),read('public/app.js')]);
  assert.match(html,/\/humanale\/nara-memory\.js/);
  assert.match(html,/\/humanale\/nara-context-bridge\.js/);
  assert.match(html,/id="memoryContextMode"/);
  assert.match(html,/id="memoryContextStatus"/);
  assert.match(app,/prepareEffectiveMemoryContext\(text,'reasoner'\)/);
  assert.match(app,/createAgentTaskPayload\(\{id,prompt,mode,prepareMemory:prepareEffectiveMemoryContext\}\)/);
  const taskHelper=await read('public/agent-task.js');
  assert.match(taskHelper,/if\(payload.mode==='analyze'\)payload.memoryContext=await prepareMemory\(prompt,'planner'\)/);
  assert.doesNotMatch(taskHelper,/prepareMemory\([^\n]*'agent'/);
  assert.match(app,/selectedMemorySource\(\)==='cloud'/);
  assert.match(app,/return stored==='cloud'\?'cloud':'local'/);
  assert.match(app,/if\(source==='cloud'&&cloudMemoryChecked&&!cloudMemoryState\.configured\)source=setMemorySource\('local'\)/);
  assert.match(app,/prepareCloudMemoryContext\(target\)/);
  assert.match(app,/prepareDesktopMemoryContext\(task,target\)/);
  assert.match(app,/window\.confirm\(/);
  assert.match(app,/memoryContext\}/);
  assert.match(app,/desktopMemoryRuntime/);
  assert.match(app,/HumanALEMemory\.create/);
  assert.match(app,/HumanALEContextBridge\.create/);
  assert.match(app,/desktopMemory\.load\?\.\(\)/);
  assert.match(app,/localStorage\.getItem\(window\.HumanALEContextBridge\?\.key/);
  assert.match(app,/desktopMemory\?\.remember\(/);
  assert.match(app,/Detail prompt dan output tidak disimpan otomatis/);
});

test('canonical site exposes context inspector and permission controls',async()=>{
  const [html,site,bridge]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/nara-context-bridge.js')
  ]);
  assert.match(html,/\.\/nara-context-bridge\.js/);
  assert.match(html,/id="contextMode"/);
  assert.match(html,/id="contextTarget"/);
  assert.match(html,/id="contextPreview"/);
  assert.match(html,/id="contextApprove"/);
  assert.match(html,/id="contextUse"/);
  assert.match(site,/HumanALEContextBridge\.create/);
  assert.match(site,/contextBridge\.approve/);
  assert.match(site,/contextBridge\.transport/);
  assert.match(site,/window\.humanALEApprovedContext/);
  assert.doesNotMatch(bridge,/fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon|process\.env/);
  assert.match(bridge,/replace\(\/\[_-\]\+\/g,' '\)/);
});

test('BrainState and Data Spine visualize context lifecycle without raw memory text',async()=>{
  delete globalThis.NeuralCore;
  delete globalThis.HumanALENaraRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?context-brain='+ ++nonce);
  await import('../sites/humanale-hologram/dist/nara-runtime.js?context-brain='+ ++nonce);
  const graph=globalThis.NeuralCore.create();
  const runtime=globalThis.HumanALENaraRuntime.create({regions:graph.regions});
  runtime.dispatch('context.prepare',{target:'planner',count:2,chars:200});
  let state=runtime.snapshot();
  assert.equal(state.regions.MEMORY.status,'processing');
  assert.equal(state.regions.PLANNER.status,'active');

  runtime.dispatch('context.approved',{target:'planner',count:2,chars:200});
  state=runtime.snapshot();
  assert.equal(state.regions.MEMORY.status,'complete');
  assert.equal(state.regions.PLANNER.status,'ready');

  runtime.dispatch('context.used',{target:'planner',count:2,chars:200});
  state=runtime.snapshot();
  assert.equal(state.regions.MEMORY.status,'active');
  assert.equal(state.regions.PLANNER.status,'processing');

  const spine=await read('sites/humanale-hologram/dist/nara-data-spine.js');
  assert.match(spine,/'context\.prepare':'MEMORY'/);
  assert.match(spine,/'context\.approved':'MEMORY'/);
  assert.match(spine,/'context\.used':'MEMORY'/);
  assert.match(spine,/'context\.blocked':'MEMORY'/);
});
