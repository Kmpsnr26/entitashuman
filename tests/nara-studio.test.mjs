import test from 'node:test';
import assert from 'node:assert/strict';
import {createNaraStudioServer,STUDIO_EVENT_ALLOWLIST} from '../nara-core/studio/server.mjs';
import {createStudioTelemetry} from '../nara-core/studio/telemetry.mjs';

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


test('NARA Studio serves the laboratory UI and streams live state over SSE',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  const page=await fetch(base+'/');
  assert.equal(page.status,200);
  assert.match(await page.text(),/NARA CORE LIVE STUDIO/);

  const controller=new AbortController();
  const stream=await fetch(base+'/api/stream',{signal:controller.signal});
  assert.equal(stream.status,200);
  assert.match(stream.headers.get('content-type')||'',/text\/event-stream/);
  const reader=stream.body.getReader();
  const first=await reader.read();
  const text=new TextDecoder().decode(first.value||new Uint8Array());
  assert.match(text,/event: state/);
  controller.abort();
});


test('decision telemetry records bounded phase status and duration without private reasoning text',()=>{
  const telemetry=createStudioTelemetry();
  telemetry.consume({id:1,event:'reason.start',timestamp:1000,payload:{label:'Analyze request'}});
  telemetry.consume({id:2,event:'reason.complete',timestamp:1450,payload:{}});
  telemetry.consume({id:3,event:'agent.start',timestamp:2000,payload:{label:'Worker A'}});
  telemetry.consume({id:4,event:'agent.failed',timestamp:2250,payload:{}});
  const snap=telemetry.snapshot();
  assert.equal(snap.decision.completedStages,1);
  assert.equal(snap.decision.failedStages,1);
  assert.equal(snap.decision.history.at(-1).stage,'agent');
  assert.equal(snap.decision.history.at(-1).durationMs,250);
  assert.equal(snap.decision.status,'failed');
  assert.equal(JSON.stringify(snap).includes('chain-of-thought'),false);
});

test('memory telemetry counts reads writes and bounded context lifecycle',()=>{
  const telemetry=createStudioTelemetry({memoryLimit:20});
  telemetry.consume({id:1,event:'memory.read',timestamp:1000,payload:{label:'Working context'}});
  telemetry.consume({id:2,event:'memory.write',timestamp:1100,payload:{label:'Task result'}});
  telemetry.consume({id:3,event:'context.used',timestamp:1200,payload:{target:'planner'}});
  telemetry.consume({id:4,event:'context.blocked',timestamp:1300,payload:{target:'agent'}});
  const snap=telemetry.snapshot();
  assert.equal(snap.memory.counters.read,1);
  assert.equal(snap.memory.counters.write,1);
  assert.equal(snap.memory.counters.context_used,1);
  assert.equal(snap.memory.counters.context_blocked,1);
  assert.equal(snap.memory.lastOperation.operation,'context_blocked');
  assert.equal(snap.memory.history.length,4);
});

test('NARA Studio snapshot and SSE expose live telemetry',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'reason.start',payload:{label:'Live telemetry'}})});
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'memory.read',payload:{label:'Context A'}})});

  const snapshot=await fetch(base+'/api/snapshot').then(r=>r.json());
  assert.equal(snapshot.telemetry.decision.currentStage,'reason');
  assert.equal(snapshot.telemetry.memory.counters.read,1);

  const controller=new AbortController();
  const stream=await fetch(base+'/api/stream',{signal:controller.signal});
  const reader=stream.body.getReader();
  let received='';
  for(let i=0;i<5&&!received.includes('event: telemetry');i++){
    const part=await reader.read();
    if(part.done)break;
    received+=new TextDecoder().decode(part.value||new Uint8Array());
  }
  controller.abort();
  assert.match(received,/event: telemetry/);
  assert.match(received,/"currentStage":"reason"/);
});
