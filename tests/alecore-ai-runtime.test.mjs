import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Electron preload exposes only the narrow AleCore AI runtime bridge',async()=>{
  const preload=await readFile(new URL('desktop/preload.cjs',root),'utf8');
  assert.match(preload,/aleSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:alecore-ai-snapshot'\)/);
  assert.match(preload,/aleSkillSnapshot:force=>ipcRenderer\.invoke\('dudidam:alecore-ai-skill-snapshot'/);
  assert.match(preload,/aleDispatch:\(event,payload=\{\}\)=>ipcRenderer\.invoke\('dudidam:alecore-ai-dispatch'/);
  assert.match(preload,/aleTestScenarios:\(\)=>ipcRenderer\.invoke\('dudidam:alecore-ai-test-scenarios'\)/);
  assert.match(preload,/aleTestScenario:scenario=>ipcRenderer\.invoke\('dudidam:alecore-ai-test-scenario'/);
  assert.match(preload,/runtimeSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:runtime-snapshot'\)/);
  assert.match(preload,/onAleState:callback/);
  assert.match(preload,/onRuntimeState:callback/);
});

test('Electron main owns and starts the AleCore AI orchestrator with renderer event allowlist',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/import\('\.\.\/alecore-ai\/brain\/index\.js'\)/);
  assert.match(main,/ale=createOrchestrator\(\{deviceProfile:systemObserver\.deviceProfile\(\),experience\}\)/);
  assert.match(main,/createSystemObserver/);
  assert.match(main,/createDataFlowMeter/);
  assert.match(main,/createExperienceModel/);
  assert.match(main,/createExperienceStore/);
  assert.match(main,/alecore-ai-experience\.json/);
  assert.match(main,/experience\.hydrate\(restoredExperience\)/);
  assert.match(main,/experienceStore\.save\(ale\.experience\.snapshot\(\)\)/);
  assert.match(main,/experienceStore\.saveSync\(ale\.experience\.snapshot\(\)\)/);
  assert.match(main,/experience\.persisted/);
  assert.match(main,/ale\.configureDevice\(systemObserver\.deviceProfile\(\)\)/);
  assert.match(main,/ale\.dispatch\('system\.telemetry'/);
  assert.match(main,/ale\.dispatch\('dataflow\.sample'/);
  assert.match(main,/ale\.dispatch\('server\.observe'/);
  assert.match(main,/ale\.start\(\)/);
  assert.match(main,/dudidam:alecore-ai-test-scenario/);
  assert.match(main,/dudidam:alecore-ai-skill-snapshot/);
  assert.match(main,/createSkillSnapshot/);
  assert.match(main,/aleSkillCache=\{at:0,agents:\[\]\}/);
  assert.match(main,/Controlled test hanya boleh dimulai saat AleCore AI idle/);
  assert.match(main,/getHumanALETestScenario/);
  assert.match(main,/aleVisualTestRunning/);
  assert.match(main,/createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime=createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime\.bindIpc\(ipcMain\)/);
  assert.match(main,/humanaleRuntime\.start\(\)/);
  assert.match(main,/humanaleRuntime\?\.stop\(\)/);
  assert.match(main,/app\.on\('before-quit'.*ale\?\.stop/s);
  assert.match(main,/aleDispatch\('audio\.energy',\{energy:\.5,low:\.2,mid:\.4,high:\.6\}\)/);
  assert.match(main,/wakeIndicator'\)\?\.dataset\.active==='false'/);
});

test('HumanALE runtime forwards real audio and camera lifecycle into AleCore AI',async()=>{
  const app=await readFile(new URL('public/app.js',root),'utf8');
  assert.match(app,/syncAleHearing/);
  assert.match(app,/aleDispatch\('audio\.energy'/);
  assert.match(app,/hearing\.start/);
  assert.match(app,/hearing\.stop/);
  assert.match(app,/applyAleHumanALEPolicy/);
  assert.match(app,/getAleHumanALEPolicy/);
  assert.match(app,/aleDispatch\('vision\.frame',\{activity:1,frameId:'camera-live'\}\)/);
  assert.match(app,/aleDispatch\('vision\.stop'\)/);
  assert.match(app,/now-lastAleAudioSent<100/);
});

test('terminal and Agent Coordinator lifecycle feed AleCore AI operational state',async()=>{
  const [main,coordinator]=await Promise.all([
    readFile(new URL('desktop/main.cjs',root),'utf8'),
    readFile(new URL('desktop/alecore-ai-agent-coordinator.mjs',root),'utf8')
  ]);
  assert.match(main,/ale\.dispatch\('terminal\.open'/);
  assert.match(main,/createAleAgentCoordinator/);
  assert.match(main,/aleAgentCoordinator=createAleAgentCoordinator/);
  assert.match(main,/aleAgentCoordinator\.run/);
  assert.match(coordinator,/this\.ale\.startWork\(/);
  assert.match(coordinator,/this\.ale\.completeWork\(/);
  assert.match(coordinator,/this\.ale\.dispatch\('agent\.start'/);
  assert.match(coordinator,/this\.ale\.dispatch\('verify\.complete'/);
  assert.match(coordinator,/this\.ale\.dispatch\('error\.detected'/);
});


test('packaged desktop CI smoke executes AleCore AI IPC and rejects untrusted renderer events',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/aleSnapshot\(\).*lifecycle==='active'/);
  assert.match(main,/aleDispatch\('brain\.region\.select',\{region:'MEMORY'\}\)/);
  assert.match(main,/selectedRegion==='MEMORY'/);
  assert.match(main,/aleDispatch\('owner\.secret',\{value:'blocked'\}\)/);
  assert.match(main,/tidak diizinkan/);
});


test('AleCore AI-owned HumanALE policy drives adaptive renderer mode',async()=>{
  const [app,avatar,engine]=await Promise.all([
    readFile(new URL('public/app.js',root),'utf8'),
    readFile(new URL('public/humanale-avatar.js',root),'utf8'),
    readFile(new URL('sites/humanale-hologram/dist/avatar.js',root),'utf8')
  ]);
  assert.match(app,/policy\?\.controlledBy==='ALECORE_AI'/);
  assert.match(avatar,/applyAlePolicy/);
  assert.match(avatar,/setRenderPolicy\?\.\(rendererMode\)/);
  assert.match(engine,/setRenderPolicy\(value = 'active'\)/);
  assert.match(engine,/mode === 'eco' \? 1000 \/ 20/);
  assert.match(engine,/mode === 'balanced' \? 1000 \/ 30 : 1000 \/ 60/);
});


test('Visual Studio test lab cannot use the generic renderer event allowlist for internal diagnostic events',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  const allowlist=main.match(/ALECORE_AI_RENDERER_EVENTS=new Set\(\[([^\]]+)\]\)/)?.[1]||'';
  for(const internalEvent of ['reason.start','error.detected','diagnostic.reset','work.start'])assert.doesNotMatch(allowlist,new RegExp(internalEvent.replace('.','\\.')));
  assert.match(main,/getHumanALETestScenario\(value\?\.scenario\)/);
});


test('AleCore AI skill snapshot caches agent probes but always recomputes from current BrainState',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/now-aleSkillCache\.at>=8000/);
  assert.match(main,/return createSkillSnapshot\(\{brainState:ale\.snapshot\(\),agents:aleSkillCache\.agents\}\)/);
  assert.doesNotMatch(main,/aleSkillCache\.value/);
});
