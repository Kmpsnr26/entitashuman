import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workReadinessError,selectWorkAgent,createAgentTaskPayload,hasAppliedWorkChanges} from '../public/agent-task.js';
import {isExplicitProjectWorkRequest} from '../public/work-intent.js';

const status=(ids=['codex','github-copilot','humanale-orchestrator'])=>({
 workReady:true,workReadiness:{ready:true},projectRootReady:true,
 agents:ids.map(id=>({id,name:id,canRun:true}))
});

test('explicit work selects a ready executor independently of the chat provider',()=>{
 assert.equal(selectWorkAgent(status(),'chatgpt').id,'humanale-orchestrator');
 assert.equal(selectWorkAgent(status(),'copilot').id,'github-copilot');
 for(const provider of ['openai','gemini','claude','grok','deepseek','askcodi'])assert.equal(selectWorkAgent(status(),provider).id,'humanale-orchestrator');
 assert.equal(selectWorkAgent(status(),'chatgpt','github-copilot').id,'github-copilot');
 assert.equal(selectWorkAgent(status(),'chatgpt','codex').id,'codex');
 assert.equal(selectWorkAgent(status(),'copilot','missing').id,'github-copilot');
 const unavailable=status();unavailable.agents.find(agent=>agent.id==='codex').canRun=false;
 assert.equal(selectWorkAgent(unavailable,'chatgpt','codex').id,'humanale-orchestrator');
 assert.equal(selectWorkAgent(status(['claude']),'chatgpt').id,'claude');
});

test('work readiness reports backend transaction blockers even when .git exists',()=>{
 for(const error of ['Branch main dilindungi.','Worktree memiliki perubahan lokal.','Checkout mengandung file secret.','Checkout mengandung symbolic link.']){
  const blocked={...status(),workReady:false,workReadiness:{ready:false,code:'BLOCKED',error}};
  assert.equal(workReadinessError(blocked),error);
  assert.throws(()=>selectWorkAgent(blocked,'chatgpt'),e=>e.message===error);
 }
 assert.match(workReadinessError({projectRootReady:true}),/belum terverifikasi/);
 assert.match(workReadinessError(null),/belum terverifikasi/);
 assert.throws(()=>selectWorkAgent(status([]),'chatgpt'),/Tidak ada executor CLI/);
 assert.equal(workReadinessError(status()),'');
 assert.equal(workReadinessError({error:'Akses ditolak.'}),'Akses ditolak.');
});

test('work payload never prepares or forwards raw memory to IPC',async()=>{
 let prepared=0,received;
 const prepareMemory=async()=>{prepared++;return {target:'agent',text:'private context'};};
 const ipc={runAgent:async payload=>{received=payload;return {mode:'work',text:'Finished.'};}};
 const executor=selectWorkAgent(status(),'chatgpt');
 await ipc.runAgent(await createAgentTaskPayload({id:executor.id,prompt:'Perbaiki proyek',mode:'work',prepareMemory}));
 assert.equal(prepared,0);
 assert.deepEqual(received,{id:'humanale-orchestrator',prompt:'Perbaiki proyek',mode:'work'});
 assert.equal(Object.hasOwn(received,'memoryContext'),false);
});

test('analysis keeps user-approved planner memory context',async()=>{
 const context={target:'planner',count:1};
 let call;
 const payload=await createAgentTaskPayload({id:'codex',prompt:'Audit bug',mode:'analyze',prepareMemory:async(...args)=>{call=args;return context;}});
 assert.deepEqual(call,['Audit bug','planner']);
 assert.deepEqual(payload,{id:'codex',prompt:'Audit bug',mode:'analyze',memoryContext:context});
});

test('completion visual requires confirmed changed files and a successful work result',()=>{
 assert.equal(hasAppliedWorkChanges({mode:'work',maintenance:{changedFiles:2}}),true);
 for(const result of [undefined,{}, {mode:'analyze',maintenance:{changedFiles:2}}, {mode:'work'}, {mode:'work',maintenance:{changedFiles:0}}, {mode:'work',maintenance:{changedFiles:'2'}}, {mode:'work',error:'rolled back',maintenance:{changedFiles:2}}])assert.equal(hasAppliedWorkChanges(result),false);
});

test('task routing keeps the existing explicit work intent boundary',()=>{
 for(const text of ['perbaiki proyek','kerjakan langsung','edit file','lanjutkan proyek'])assert.equal(isExplicitProjectWorkRequest(text),true);
 for(const text of ['lanjutkan ini','buat cerita','apa masalahnya sekarang?','jelaskan cara memperbaiki'])assert.equal(isExplicitProjectWorkRequest(text),false);
});

test('renderer uses readiness and shared payload policy for both manual and chat tasks',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/if\(!image&&isExplicitProjectWorkRequest\(text\)\)/);
 assert.doesNotMatch(app,/aiProvider==='copilot'&&!image&&isExplicitProjectWorkRequest/);
 assert.match(app,/const orchestratorReady=\(status\.agents\|\|\[\]\)\.some\(agent=>agent\.id==='humanale-orchestrator'&&agent\.canRun===true\)/);
 assert.match(app,/const preferredAgent=selectedDeveloperAgentId\|\|\(orchestratorReady\?'humanale-orchestrator':''\)/);
 assert.match(app,/selectWorkAgent\(status,aiProvider,preferredAgent\)/);
 assert.match(app,/createAgentTaskPayload\(\{id,prompt,mode,prepareMemory:prepareEffectiveMemoryContext\}\)/);
 assert.match(app,/workSucceeded=hasAppliedWorkChanges\(result\)/);
 assert.match(app,/Mode Kerja diblokir:/);
 assert.doesNotMatch(app,/Project checkout siap:/);
});
