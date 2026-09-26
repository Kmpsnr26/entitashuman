import test from 'node:test';
import assert from 'node:assert/strict';
import {createNaraStudioServer,STUDIO_EVENT_ALLOWLIST} from '../nara-core/studio/server.mjs';

test('NARA Studio runs headless core and exposes realtime snapshot',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  const res=await fetch(base+'/api/snapshot');
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.state.lifecycle,'active');
  assert.equal(Object.keys(data.regions).length,22);
  assert.ok(Array.isArray(data.studio.eventAllowlist));
});

test('NARA Studio accepts allowlisted brain event and rejects arbitrary event',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  assert.ok(STUDIO_EVENT_ALLOWLIST.includes('reason.start'));

  const ok=await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'reason.start',payload:{label:'Studio test'}})});
  assert.equal(ok.status,200);
  assert.equal(studio.nara.snapshot().regions.REASONER.status,'thinking');

  const denied=await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'terminal.exec',payload:{command:'whoami'}})});
  assert.equal(denied.status,403);
});

test('NARA Studio reset preserves standalone NARA operation',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'work.start',payload:{id:'studio-test',label:'Live Studio'}})});
  assert.ok(studio.nara.snapshot().currentTask);
  const reset=await fetch(base+'/api/reset',{method:'POST'});
  assert.equal(reset.status,200);
  assert.equal(studio.nara.snapshot().lifecycle,'active');
});
