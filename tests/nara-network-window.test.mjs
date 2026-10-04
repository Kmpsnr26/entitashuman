import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrchestrator} from '../nara-core/brain/index.js';
import {createOwnerStore} from '../nara-core/security/owner-store.mjs';
import {createNaraStudioServer} from '../nara-core/studio/server.mjs';

test('embedded NARA Studio projects safe telemetry from the shared desktop runtime',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'humanale-network-studio-'));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const ownerStore=createOwnerStore({filePath:join(temp,'owner.json')});
  ownerStore.provision({username:'shared-owner',password:'shared-owner-password'});
  const nara=createOrchestrator();
  nara.start();
  const studio=createNaraStudioServer({
    host:'127.0.0.1',
    port:0,
    nara,
    embedded:true,
    creatorAuth:{required:true,credentialStore:ownerStore}
  });
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  assert.equal(studio.nara,nara);
  assert.equal(studio.ownerStore,ownerStore);

  const login=await fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json',origin:base},
    body:JSON.stringify({username:'shared-owner',password:'shared-owner-password'})
  });
  assert.equal(login.status,200);
  assert.equal((await login.json()).username,undefined);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers={cookie};

  const fakeSecret='FAKE-DESKTOP-SECRET-DO-NOT-LEAK-739154';
  nara.dispatch('work.start',{id:'private-task-id',label:fakeSecret});
  nara.dispatch('error.detected',{message:fakeSecret});

  const response=await fetch(base+'/api/snapshot',{headers});
  assert.equal(response.status,200);
  const payload=await response.json();
  const serialized=JSON.stringify(payload);
  assert.equal(serialized.includes(fakeSecret),false);
  assert.equal(serialized.includes('private-task-id'),false);
  assert.equal(payload.state.currentTask,null);
  assert.equal(payload.telemetry.diagnostics.current.message,'');
  assert.deepEqual(payload.events,[]);
  assert.equal(payload.studio.embedded,true);
  assert.deepEqual(payload.studio.eventAllowlist,['brain.region.select']);
  const regionResponse=await fetch(base+'/api/creator/region/NARA_CORE',{headers});
  assert.equal(regionResponse.status,200);
  assert.equal((await regionResponse.text()).includes(fakeSecret),false);

  const reflectedEvent=await fetch(base+'/api/event',{
    method:'POST',headers:{...headers,'content-type':'application/json',origin:base},
    body:JSON.stringify({event:fakeSecret,payload:{message:fakeSecret}})
  });
  assert.equal(reflectedEvent.status,403);
  assert.equal((await reflectedEvent.text()).includes(fakeSecret),false);

  const controller=new AbortController();
  const stream=await fetch(base+'/api/stream',{headers,signal:controller.signal});
  assert.equal(stream.status,200);
  const reader=stream.body.getReader();
  let streamed='';
  while(!streamed.includes('event: ready')){
    const next=await reader.read();
    if(next.done)break;
    streamed+=new TextDecoder().decode(next.value);
  }
  controller.abort();
  assert.equal(streamed.includes(fakeSecret),false);
  assert.equal(streamed.includes('event: event'),false);

  const select=await fetch(base+'/api/event',{
    method:'POST',headers:{...headers,'content-type':'application/json',origin:base},
    body:JSON.stringify({event:'brain.region.select',payload:{region:'MEMORY'}})
  });
  assert.equal(select.status,200);
  assert.equal(nara.snapshot().selectedRegion,'MEMORY');
  assert.equal((await select.json()).state.selectedRegion,'MEMORY');

  for(const [path,body] of [
    ['/api/reset',{}],
    ['/api/event',{event:'reason.start',payload:{label:'simulation'}}]
  ]){
    const denied=await fetch(base+path,{
      method:'POST',headers:{...headers,'content-type':'application/json',origin:base},
      body:JSON.stringify(body)
    });
    assert.equal(denied.status,403,path);
  }

  await studio.stop();
  assert.equal(nara.running,true);
  assert.equal(nara.snapshot().lifecycle,'active');
});

test('desktop NARA Network window stays owner-gated and hardened in packaged smoke',async()=>{
  const [main,preload,html,packager,studioApp,studioCss]=await Promise.all([
    readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8'),
    readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../package-desktop.mjs',import.meta.url),'utf8'),
    readFile(new URL('../nara-core/studio/public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../nara-core/studio/public/styles.css',import.meta.url),'utf8')
  ]);
  assert.match(html,/id="naraNetworkOpen"[^>]*hidden/);
  assert.match(preload,/openNaraNetwork:.*dudidam:nara-network-open/);
  assert.match(main,/ipcMain\.handle\('dudidam:nara-network-open',e=>\{\s*if\(!ownerTrusted\(e\)\)/);
  assert.match(main,/nara,\s*embedded:true,\s*creatorAuth:\{required:true,credentialStore:ownerStore\}/);
  assert.match(main,/nodeIntegration:false,contextIsolation:true,sandbox:true,\s*partition:'nara-network-studio'/);
  assert.match(main,/clearStorageData\(\{storages:\['cookies'\]\}\)/);
  assert.match(main,/setWindowOpenHandler\(\(\)=>\(\{action:'deny'\}\)\)/);
  assert.match(main,/will-frame-navigate/);
  assert.match(main,/loadURL\(studioOrigin\+'\/\?embedded=1'\)/);
  assert.match(studioApp,/get\('embedded'\)==='1'.*embedded-studio/s);
  assert.match(studioCss,/body\.embedded-studio \.console-panel/);
  assert.match(main,/naraNetworkStudio\.nara!==nara/);
  assert.match(main,/network3dReady/);
  assert.match(main,/brainNodes[^\n]*GITHUB/);
  assert.match(main,/nara\.snapshot\(\)\.selectedRegion!=='GITHUB'/);
  assert.match(packager,/\['three'\]/);
});
