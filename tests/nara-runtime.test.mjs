import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Electron preload exposes only the narrow NARA runtime bridge',async()=>{
  const preload=await readFile(new URL('desktop/preload.cjs',root),'utf8');
  assert.match(preload,/naraSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:nara-snapshot'\)/);
  assert.match(preload,/naraDispatch:\(event,payload=\{\}\)=>ipcRenderer\.invoke\('dudidam:nara-dispatch'/);
  assert.match(preload,/naraTestScenarios:\(\)=>ipcRenderer\.invoke\('dudidam:nara-test-scenarios'\)/);
  assert.match(preload,/naraTestScenario:scenario=>ipcRenderer\.invoke\('dudidam:nara-test-scenario'/);
  assert.match(preload,/onNaraState:callback/);
});

test('Electron main owns and starts the NARA orchestrator with renderer event allowlist',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/import\('\.\.\/nara-core\/brain\/index\.js'\)/);
  assert.match(main,/nara=createOrchestrator\(\)/);
  assert.match(main,/nara\.start\(\)/);
  assert.match(main,/NARA_RENDERER_EVENTS=new Set\(\['hearing\.start','hearing\.stop','audio\.energy','vision\.frame','vision\.stop','speech\.start','speech\.energy','speech\.stop','brain\.region\.select'\]\)/);
  assert.match(main,/Event NARA tidak diizinkan dari renderer/);
  assert.match(main,/dudidam:nara-test-scenario/);
  assert.match(main,/Controlled test hanya boleh dimulai saat NARA idle/);
  assert.match(main,/getHumanALETestScenario/);
  assert.match(main,/naraVisualTestRunning/);
  assert.match(main,/app\.on\('before-quit'.*nara\?\.stop/s);
});

test('HumanALE runtime forwards real audio and camera lifecycle into NARA',async()=>{
  const app=await readFile(new URL('public/app.js',root),'utf8');
  assert.match(app,/syncNaraHearing/);
  assert.match(app,/naraDispatch\('audio\.energy'/);
  assert.match(app,/hearing\.start/);
  assert.match(app,/hearing\.stop/);
  assert.match(app,/applyNaraHumanALEPolicy/);
  assert.match(app,/getNaraHumanALEPolicy/);
  assert.match(app,/naraDispatch\('vision\.frame',\{activity:1,frameId:'camera-live'\}\)/);
  assert.match(app,/naraDispatch\('vision\.stop'\)/);
  assert.match(app,/now-lastNaraAudioSent<100/);
});

test('terminal and agent work lifecycle feed NARA operational state',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/nara\.dispatch\('terminal\.open'/);
  assert.match(main,/nara\.startWork\(/);
  assert.match(main,/nara\.completeWork\(/);
  assert.match(main,/nara\.dispatch\('error\.detected'/);
});


test('packaged desktop CI smoke executes NARA IPC and rejects untrusted renderer events',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/naraSnapshot\(\).*lifecycle==='active'/);
  assert.match(main,/naraDispatch\('brain\.region\.select',\{region:'MEMORY'\}\)/);
  assert.match(main,/selectedRegion==='MEMORY'/);
  assert.match(main,/naraDispatch\('owner\.secret',\{value:'blocked'\}\)/);
  assert.match(main,/tidak diizinkan/);
});


test('NARA-owned HumanALE policy drives adaptive renderer mode',async()=>{
  const [app,avatar,engine]=await Promise.all([
    readFile(new URL('public/app.js',root),'utf8'),
    readFile(new URL('public/humanale-avatar.js',root),'utf8'),
    readFile(new URL('sites/humanale-hologram/dist/avatar.js',root),'utf8')
  ]);
  assert.match(app,/policy\?\.controlledBy==='NARA_CORE'/);
  assert.match(avatar,/applyNaraPolicy/);
  assert.match(avatar,/setRenderPolicy\?\.\(rendererMode\)/);
  assert.match(engine,/setRenderPolicy\(value = 'active'\)/);
  assert.match(engine,/mode === 'eco' \? 1000 \/ 20/);
  assert.match(engine,/mode === 'balanced' \? 1000 \/ 30 : 1000 \/ 60/);
});


test('Visual Studio test lab cannot use the generic renderer event allowlist for internal diagnostic events',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  const allowlist=main.match(/NARA_RENDERER_EVENTS=new Set\(\[([^\]]+)\]\)/)?.[1]||'';
  for(const internalEvent of ['reason.start','error.detected','diagnostic.reset','work.start'])assert.doesNotMatch(allowlist,new RegExp(internalEvent.replace('.','\\.')));
  assert.match(main,/getHumanALETestScenario\(value\?\.scenario\)/);
});
