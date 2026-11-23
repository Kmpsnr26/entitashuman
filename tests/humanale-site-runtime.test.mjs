import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

async function createSiteRuntime(){
  delete globalThis.NeuralCore;
  delete globalThis.HumanALENaraRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?site-runtime-test='+Date.now());
  await import('../sites/humanale-hologram/dist/nara-runtime.js?site-runtime-test='+Date.now());
  const graph=globalThis.NeuralCore.create();
  const cues=[];
  const runtime=globalThis.HumanALENaraRuntime.create({regions:graph.regions,onVoice:cue=>cues.push(cue)});
  return {graph,runtime,cues};
}

test('canonical HumanALE site loads browser-safe NARA runtime before avatar application',async()=>{
  const html=await read('sites/humanale-hologram/dist/index.html');
  const runtimeIndex=html.indexOf('./nara-runtime.js');
  const avatarIndex=html.indexOf('./avatar.js');
  const siteIndex=html.indexOf('./site.js');
  assert.ok(runtimeIndex>0);
  assert.ok(runtimeIndex<avatarIndex);
  assert.ok(avatarIndex<siteIndex);
});

test('site NARA runtime preserves core BrainState and EventBus behavior',async()=>{
  const {graph,runtime,cues}=await createSiteRuntime();
  assert.equal(graph.regions.length,22);

  runtime.start();
  let state=runtime.snapshot();
  assert.equal(state.lifecycle,'active');
  assert.equal(state.regions.NARA_CORE.status,'active');
  assert.equal(cues.at(-1).text,'AleCore AI aktif. Sistem HumanALE siap.');

  runtime.dispatch('brain.region.select',{region:'MEMORY'});
  state=runtime.snapshot();
  assert.equal(state.selectedRegion,'MEMORY');
  assert.equal(state.regions.MEMORY.status,'active');
  assert.equal(cues.at(-1).text,'Membuka Memory.');

  runtime.dispatch('github.connected');
  state=runtime.snapshot();
  assert.equal(state.regions.GITHUB.status,'connected');

  runtime.dispatch('audio.energy',{energy:.7,low:.5,mid:.6,high:.4});
  state=runtime.snapshot();
  assert.equal(state.sensory.hearing.active,true);
  assert.equal(state.sensory.hearing.energy,.7);

  runtime.dispatch('error.detected',{message:'uji'});
  state=runtime.snapshot();
  assert.equal(state.regions.ERROR_MONITOR.status,'error');
  assert.equal(state.regions.BUG_HUNTER.status,'processing');
});

test('site runtime remains visual/browser-only and carries no secrets or privileged transport',async()=>{
  const runtime=await read('sites/humanale-hologram/dist/nara-runtime.js');
  assert.doesNotMatch(runtime,/OPENAI_API_KEY|GITHUB_TOKEN|process\.env|private[_-]?key/i);
  assert.doesNotMatch(runtime,/fetch\s*\(|WebSocket|child_process|node-pty|ipcRenderer|shell\.openExternal/);
  assert.match(runtime,/historyLimit=250/);
  assert.match(runtime,/style:'adult-robot'/);
});

test('canonical site wires real NARA state into the existing avatar instead of replacing the face',async()=>{
  const [site,avatar,index]=await Promise.all([
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/avatar.js'),
    read('sites/humanale-hologram/dist/index.html')
  ]);
  assert.match(site,/window\.AleCoreAIRuntime\|\|window\.HumanALENaraRuntime/);
  assert.match(site,/Runtime\.create/);
  assert.match(site,/window\.humanALENara=runtime/);
  assert.match(site,/runtime\.state\.subscribe\(snapshot=>\{/);
  assert.match(site,/avatar\.setBrainState\?\.\(snapshot\)/);
  assert.match(site,/avatar\.onBrainRegionSelect=region=>/);
  assert.match(site,/runtime\.dispatch\('brain\.region\.select'/);
  assert.match(site,/window\.humanALENara=runtime/);
  assert.match(site,/naraVoiceUnlocked=false/);
  assert.match(site,/pointerdown',unlockNaraVoice/);
  assert.match(site,/runtime\.dispatch\('speech\.start'/);
  assert.match(site,/runtime\.dispatch\('speech\.stop'/);
  assert.match(avatar,/buildFallback\(\)/);
  assert.doesNotMatch(avatar,/loadReference|referencePromise|referencePoints|new Image/);
  assert.match(site,/new window\.NeuralAvatar\(canvas\);/);
  assert.doesNotMatch(site,/referenceSrc\s*:|reference-face\.png/);
});

test('site runtime supports the important connection and workflow events copied from NARA core',async()=>{
  const {runtime}=await createSiteRuntime();
  runtime.dispatch('copilot.connected');
  runtime.dispatch('drive.connected');
  runtime.dispatch('sync.start');
  runtime.dispatch('work.start',{id:'t1',label:'Uji kerja'});
  let state=runtime.snapshot();
  assert.equal(state.regions.COPILOT.status,'connected');
  assert.equal(state.regions.DRIVE.status,'connected');
  assert.equal(state.regions.SYNC.status,'syncing');
  assert.equal(state.regions.PROGRAM.status,'processing');
  assert.equal(state.currentTask.id,'t1');

  runtime.dispatch('work.complete');
  runtime.dispatch('sync.complete');
  state=runtime.snapshot();
  assert.equal(state.regions.PROGRAM.status,'complete');
  assert.equal(state.regions.REPORTING.status,'active');
  assert.equal(state.regions.SYNC.status,'complete');
  assert.equal(state.currentTask,null);
});
