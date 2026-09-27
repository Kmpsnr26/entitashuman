import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('Electron preload exposes only the narrow NARA runtime bridge',async()=>{
  const preload=await readFile(new URL('desktop/preload.cjs',root),'utf8');
  assert.match(preload,/naraSnapshot:\(\)=>ipcRenderer\.invoke\('dudidam:nara-snapshot'\)/);
  assert.match(preload,/naraDispatch:\(event,payload=\{\}\)=>ipcRenderer\.invoke\('dudidam:nara-dispatch'/);
  assert.match(preload,/onNaraState:callback/);
});

test('Electron main owns and starts the NARA orchestrator with renderer event allowlist',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/import\('\.\.\/nara-core\/brain\/index\.js'\)/);
  assert.match(main,/nara=createOrchestrator\(\)/);
  assert.match(main,/nara\.start\(\)/);
  assert.match(main,/import\('\.\/startup-connections\.mjs'\)/);
  assert.match(main,/bootstrapNaraConnections\(\{bridges,agentHub,nara\}\)/);
  assert.match(main,/NARA_RENDERER_EVENTS=new Set\(\['audio\.energy','vision\.frame','vision\.stop','speech\.start','speech\.energy','speech\.stop','brain\.region\.select'\]\)/);
  assert.match(main,/Event NARA tidak diizinkan dari renderer/);
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

test('terminal and agent work lifecycle feed NARA operational state',async()=>{
  const main=await readFile(new URL('desktop/main.cjs',root),'utf8');
  assert.match(main,/nara\.dispatch\('terminal\.open'/);
  assert.match(main,/nara\.startWork\(/);
  assert.match(main,/nara\.completeWork\(/);
  assert.match(main,/nara\.dispatch\('error\.detected'/);
});
