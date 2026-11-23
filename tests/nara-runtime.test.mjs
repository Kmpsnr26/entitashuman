import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Electron preload exposes only the narrow NARA runtime bridge',async()=>{
  const preload=await readFile(new URL('desktop/preload.cjs',root),'utf8');
  assert.match(preload,/naraSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:nara-snapshot'\)/);
  assert.match(preload,/naraSkillSnapshot:force=>ipcRenderer\.invoke\('dudidam:nara-skill-snapshot'/);
  assert.match(preload,/naraDispatch:\(event,payload=\{\}\)=>ipcRenderer\.invoke\('dudidam:nara-dispatch'/);
  assert.match(preload,/naraTestScenarios:\(\)=>ipcRenderer\.invoke\('dudidam:nara-test-scenarios'\)/);
  assert.match(preload,/naraTestScenario:scenario=>ipcRenderer\.invoke\('dudidam:nara-test-scenario'/);
  assert.match(preload,/runtimeSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:runtime-snapshot'\)/);
  assert.match(preload,/onNaraState:callback/);
  assert.match(preload,/onRuntimeState:callback/);
});

test('Electron main owns and starts the NARA orchestrator with renderer event allowlist',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/import\('\.\.\/nara-core\/brain\/index\.js'\)/);
  assert.match(main,/nara=createOrchestrator\(\{deviceProfile:systemObserver\.deviceProfile\(\),experience\}\)/);
  assert.match(main,/createSystemObserver/);
  assert.match(main,/createDataFlowMeter/);
  assert.match(main,/createExperienceModel/);
  assert.match(main,/createExperienceStore/);
  assert.match(main,/nara-experience\.json/);
  assert.match(main,/experience\.hydrate\(restoredExperience\)/);
  assert.match(main,/experienceStore\.save\(nara\.experience\.snapshot\(\)\)/);
  assert.match(main,/experienceStore\.saveSync\(nara\.experience\.snapshot\(\)\)/);
  assert.match(main,/experience\.persisted/);
  assert.match(main,/nara\.configureDevice\(systemObserver\.deviceProfile\(\)\)/);
  assert.match(main,/nara\.dispatch\('system\.telemetry'/);
  assert.match(main,/nara\.dispatch\('dataflow\.sample'/);
  assert.match(main,/nara\.dispatch\('server\.observe'/);
  assert.match(main,/nara\.start\(\)/);
  assert.match(main,/dudidam:nara-test-scenario/);
  assert.match(main,/dudidam:nara-skill-snapshot/);
  assert.match(main,/createSkillSnapshot/);
  assert.match(main,/naraSkillCache=\{at:0,agents:\[\]\}/);
  assert.match(main,/Controlled test hanya boleh dimulai saat NARA idle/);
  assert.match(main,/getHumanALETestScenario/);
  assert.match(main,/naraVisualTestRunning/);
  assert.match(main,/createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime=createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime\.bindIpc\(ipcMain\)/);
  assert.match(main,/humanaleRuntime\.start\(\)/);
  assert.match(main,/humanaleRuntime\?\.stop\(\)/);
  assert.match(main,/app\.on\('before-quit'.*nara\?\.stop/s);
  assert.match(main,/naraDispatch\('audio\.energy',\{energy:\.5,low:\.2,mid:\.4,high:\.6\}\)/);
  assert.match(main,/wakeIndicator'\)\?\.dataset\.active==='false'/);
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

test('terminal and Agent Coordinator lifecycle feed NARA operational state',async()=>{
  const [main,coordinator]=await Promise.all([
    readFile(new URL('desktop/main.cjs',root),'utf8'),
    readFile(new URL('desktop/nara-agent-coordinator.mjs',root),'utf8')
  ]);
  assert.match(main,/nara\.dispatch\('terminal\.open'/);
  assert.match(main,/createAleCoreAgentCoordinator/);
  assert.match(main,/naraAgentCoordinator=createAleCoreAgentCoordinator/);
  assert.match(main,/naraAgentCoordinator\.run/);
  assert.match(coordinator,/this\.nara\.startWork\(/);
  assert.match(coordinator,/this\.nara\.completeWork\(/);
  assert.match(coordinator,/this\.nara\.dispatch\('agent\.start'/);
  assert.match(coordinator,/this\.nara\.dispatch\('verify\.complete'/);
  assert.match(coordinator,/this\.nara\.dispatch\('error\.detected'/);
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


test('NARA skill snapshot caches agent probes but always recomputes from current BrainState',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/now-naraSkillCache\.at>=8000/);
  assert.match(main,/return createSkillSnapshot\(\{brainState:nara\.snapshot\(\),agents:naraSkillCache\.agents\}\)/);
  assert.doesNotMatch(main,/naraSkillCache\.value/);
});
