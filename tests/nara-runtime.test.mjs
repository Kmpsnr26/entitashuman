import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Electron preload exposes only the narrow NARA runtime bridge',async()=>{
  const preload=await readFile(new URL('desktop/preload.cjs',root),'utf8');
  assert.match(preload,/naraSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:nara-snapshot'\)/);
  assert.match(preload,/naraDispatch:\(event,payload=\{\}\)=>ipcRenderer\.invoke\('dudidam:nara-dispatch'/);
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
  assert.match(main,/createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime=createHumanALERuntimeHost/);
  assert.match(main,/humanaleRuntime\.bindIpc\(ipcMain\)/);
  assert.match(main,/humanaleRuntime\.start\(\)/);
  assert.match(main,/humanaleRuntime\?\.stop\(\)/);
  assert.match(main,/app\.on\('before-quit'.*nara\?\.stop/s);
});

test('HumanALE runtime forwards real audio and camera lifecycle into NARA',async()=>{
  const app=await readFile(new URL('public/app.js',root),'utf8');
  assert.match(app,/syncNaraHearing/);
  assert.match(app,/naraDispatch\('audio\.energy'/);
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
  assert.match(main,/createNaraAgentCoordinator/);
  assert.match(main,/naraAgentCoordinator=createNaraAgentCoordinator/);
  assert.match(main,/naraAgentCoordinator\.run/);
  assert.match(coordinator,/this\.nara\.startWork\(/);
  assert.match(coordinator,/this\.nara\.completeWork\(/);
  assert.match(coordinator,/this\.nara\.dispatch\('agent\.start'/);
  assert.match(coordinator,/this\.nara\.dispatch\('verify\.complete'/);
  assert.match(coordinator,/this\.nara\.dispatch\('error\.detected'/);
});
