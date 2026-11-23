import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  authorizedDisplayMediaTarget,
  createHumanALEOwnerGate,
  isOwnerTargetUnlocked
} from '../desktop/humanale-owner-gate.mjs';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('V3.5 desktop shares the persistent AleCore AI Owner Store and gates unified runtime',async()=>{
  const [main,preload,runtimeHost]=await Promise.all([
    read('desktop/main.cjs'),
    read('desktop/preload.cjs'),
    read('desktop/humanale-runtime-host.mjs')
  ]);

  assert.match(main,/ALECORE_AI_OWNER_STORE\|\|path\.join\(homedir\(\),'\.nara','owner\.json'\)/);
  assert.match(main,/createOwnerStore/);
  assert.match(main,/createHumanALEOwnerGate/);
  assert.match(main,/delete process\.env\.ALECORE_AI_CREATOR_PASSWORD/);
  assert.match(main,/const ownerTrusted=e=>trusted\(e\)&&ownerGate\?\.isUnlocked/);
  assert.match(main,/isTrustedEvent:ownerTrusted/);
  assert.match(main,/getTargets:\(\)=>\[win,panelWin\]\.filter\(target=>target&&ownerGate\?\.isUnlocked/);
  assert.match(main,/randomUUID\(\)/);
  assert.doesNotMatch(main,/CI-[A-Za-z0-9_-]{12,}-AleCore AI!/);

  for(const api of [
    'ownerStatus','ownerProvision','ownerLogin','ownerLogout','ownerChangeLogin','onOwnerState'
  ])assert.match(preload,new RegExp(api));

  assert.match(runtimeHost,/isTrustedEvent/);
});

test('V3.5 high-impact HumanALE IPC surfaces require Creator unlock',async()=>{
  const main=await read('desktop/main.cjs');
  const handlers=[
    'dudidam:cloud-status','dudidam:cloud-login','dudidam:cloud-context',
    'dudidam:status','dudidam:ask','dudidam:login','dudidam:login-copilot',
    'dudidam:stt-status','dudidam:transcribe','dudidam:tts-status','dudidam:tts-stop','dudidam:synthesize',
    'dudidam:agents','dudidam:project-root-choose','dudidam:agent-run','dudidam:agent-open',
    'dudidam:terminal-create','dudidam:terminal-write','dudidam:terminal-resize',
    'dudidam:terminal-kill','dudidam:terminal-restart','dudidam:terminal-clear',
    'dudidam:terminal-list','dudidam:terminal-detect','dudidam:terminal-recent',
    'dudidam:terminal-cwd','dudidam:terminal-policy','dudidam:terminal-execute',
    'dudidam:terminal-open'
  ];
  for(const channel of handlers){
    const marker="ipcMain.handle('"+channel+"'";
    const start=main.indexOf(marker);
    assert.notEqual(start,-1,channel+' missing');
    const next=main.indexOf('\n  ipcMain.',start+marker.length);
    const block=main.slice(start,next<0?main.length:next);
    assert.match(block,/ownerTrusted\(e\)/,channel+' must require Creator unlock');
  }

  assert.match(main,/ipcMain\.on\('dudidam:panel-open'.*ownerTrusted\(e\)/);
  assert.match(main,/setPermissionCheckHandler[\s\S]{0,350}ownerGate\.isUnlocked/);
  assert.match(main,/setDisplayMediaRequestHandler[\s\S]{0,500}authorizedDisplayMediaTarget/);
  assert.match(main,/setPermissionRequestHandler[\s\S]{0,500}ownerGate\.isUnlocked/);
});

test('V3.5 Creator UI never persists password fields in browser storage',async()=>{
  const [html,app,css]=await Promise.all([
    read('public/index.html'),
    read('public/app.js'),
    read('public/style.css')
  ]);

  for(const id of [
    'ownerGate','ownerGateForm','ownerUsername','ownerPassword','ownerConfirmPassword',
    'ownerSecurity','ownerCurrentPassword','ownerNewUsername','ownerNewPassword',
    'ownerChangeLogin','ownerLogout'
  ])assert.match(html,new RegExp('id="'+id+'"'));

  assert.match(html,/id="ownerPassword" type="password"/);
  assert.match(html,/id="ownerCurrentPassword" type="password"/);
  assert.match(html,/id="ownerNewPassword" type="password"/);
  assert.match(app,/desktop\.ownerStatus\(\)/);
  assert.match(app,/desktop\.ownerLogin/);
  assert.match(app,/desktop\.ownerProvision/);
  assert.match(app,/desktop\.ownerChangeLogin/);
  assert.match(app,/desktop\.ownerLogout/);
  assert.match(app,/password\.value=''/);
  assert.doesNotMatch(app,/localStorage\.(?:setItem|getItem)\([^\n)]*owner/i);
  assert.match(css,/V3\.5 Creator Gate/);
  assert.match(css,/\.creator-locked/);
});

test('V3.5 outbound desktop streams and display capture require the receiving Creator session',async()=>{
  const main=await read('desktop/main.cjs');
  assert.match(main,/emitTerminal=.*isOwnerTargetUnlocked\(target,ownerGate\)/);
  assert.match(main,/authorizedDisplayMediaTarget\(request,\{targets:\[win,panelWin\],ownerGate,origin\}\)/);

  const frameA={},frameB={};
  const target=id=>({
    isDestroyed:()=>false,
    webContents:{id,isDestroyed:()=>false,mainFrame:id===1?frameA:frameB}
  });
  const first=target(1),second=target(2);
  const ownerGate={isUnlocked:actor=>actor==='1'};

  assert.equal(isOwnerTargetUnlocked(first,ownerGate),true);
  assert.equal(isOwnerTargetUnlocked(second,ownerGate),false);
  const request={
    frame:frameA,
    securityOrigin:'http://127.0.0.1:4321',
    userGesture:true,
    audioRequested:true
  };
  assert.equal(authorizedDisplayMediaTarget(request,{
    targets:[first,second],ownerGate,origin:'http://127.0.0.1:4321'
  }),first);
  assert.equal(authorizedDisplayMediaTarget({...request,frame:frameB},{
    targets:[first,second],ownerGate,origin:'http://127.0.0.1:4321'
  }),null,'locked requester must not inherit another window session');
  assert.equal(authorizedDisplayMediaTarget({...request,userGesture:false},{
    targets:[first,second],ownerGate,origin:'http://127.0.0.1:4321'
  }),null);
});

test('V3.5 failed Creator login preserves canonical configured state for UI retry',()=>{
  const store={
    configured:()=>true,
    publicProfile:()=>({configured:true,username:'creator'}),
    verify:()=>false,
    provision:()=>{},
    changeCredentials:()=>{}
  };
  const gate=createHumanALEOwnerGate({store});
  const result=gate.login('window-a',{username:'creator',password:'wrong'});
  assert.equal(result.ok,false);
  assert.equal(result.configured,true);
  assert.equal(result.unlocked,false);
  assert.equal(result.username,'creator');
  assert.match(result.error,/tidak cocok/i);
});
