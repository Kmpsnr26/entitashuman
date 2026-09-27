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


test('NARA skill registry follows cognitive and agent lifecycle events',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'reason.start',payload:{label:'Reason skill'}})});
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'reason.complete',payload:{}})});
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'agent.start',payload:{label:'Worker skill'}})});
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'agent.failed',payload:{}})});

  const data=await fetch(base+'/api/snapshot').then(r=>r.json());
  const reason=data.skills.skills.find(skill=>skill.id==='reason');
  const agent=data.skills.skills.find(skill=>skill.id==='agent.manage');
  assert.equal(data.skills.total,9);
  assert.equal(reason.runs,1);
  assert.equal(reason.successes,1);
  assert.equal(reason.status,'complete');
  assert.equal(agent.runs,1);
  assert.equal(agent.failures,1);
  assert.equal(agent.status,'failed');
});


test('diagnostic telemetry tracks error repair and verification cycle',()=>{
  const telemetry=createStudioTelemetry();
  telemetry.consume({id:1,event:'error.detected',timestamp:1000,payload:{message:'Renderer error'}});
  telemetry.consume({id:2,event:'bug.detected',timestamp:1100,payload:{message:'State bug'}});
  telemetry.consume({id:3,event:'bug.fixed',timestamp:1600,payload:{message:'Patch applied'}});
  telemetry.consume({id:4,event:'verify.start',timestamp:1700,payload:{}});
  telemetry.consume({id:5,event:'verify.complete',timestamp:1800,payload:{}});
  const snap=telemetry.snapshot();
  assert.equal(snap.diagnostics.counters.errors,1);
  assert.equal(snap.diagnostics.counters.bugs,1);
  assert.equal(snap.diagnostics.counters.fixed,1);
  assert.equal(snap.diagnostics.counters.verified,1);
  assert.equal(snap.diagnostics.lastRepairDurationMs,500);
  assert.equal(snap.diagnostics.status,'verified');
  assert.equal(snap.diagnostics.active,false);
  assert.equal(snap.performance.totalEvents,5);
  assert.equal(snap.performance.events10s,5);
  assert.ok(Number.isFinite(snap.performance.startedAt));
});

test('event replay is visual-only and exposes no replay execution API',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,server]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/server.mjs',root),'utf8')
  ]);
  assert.match(html,/Event Timeline \/ Replay/);
  assert.match(html,/visual replay only/);
  assert.match(app,/function startReplay\(\)/);
  assert.match(app,/renderEventItems\(shown\)/);
  assert.doesNotMatch(server,/\/api\/replay/);
  assert.doesNotMatch(app,/fetch\('\/api\/replay/);
});


test('NARA Studio reset clears skill runtime counters',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'agent.start',payload:{label:'Reset test'}})});
  await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'agent.complete',payload:{}})});
  assert.equal(studio.skills.get('agent.manage').runs,1);
  const reset=await fetch(base+'/api/reset',{method:'POST'});
  assert.equal(reset.status,200);
  assert.equal(studio.skills.get('agent.manage').runs,0);
  assert.equal(studio.skills.get('agent.manage').status,'ready');
});


test('NARA Studio exposes experimental 3D Neural Space without removing 2D fallback',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  const html=await fetch(base+'/').then(r=>r.text());
  assert.match(html,/2D Brain Map/);
  assert.match(html,/3D Neural Explorer/);
  assert.match(html,/id="brainMap"/);
  assert.match(html,/id="neural3dHost"/);

  const app=await fetch(base+'/app.js').then(r=>r.text());
  assert.match(app,/import\('\.\/neural-space\.js'\)/);
  assert.match(app,/function setStudioView\(mode\)/);

  const scene=await fetch(base+'/neural-space.js');
  assert.equal(scene.status,200);
  assert.match(await scene.text(),/class Neural3DScene/);
});

test('NARA Studio serves Three.js from a fixed same-origin vendor route',async t=>{
  const studio=createNaraStudioServer({host:'127.0.0.1',port:0});
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  const res=await fetch(base+'/vendor/three/three.module.js');
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type')||'',/text\/javascript/);
  const source=await res.text();
  assert.match(source,/WebGLRenderer/);

  const core=await fetch(base+'/vendor/three/three.core.js');
  assert.equal(core.status,200);
  assert.match(core.headers.get('content-type')||'',/text\/javascript/);
  const coreSource=await core.text();
  assert.match(coreSource,/class Vector3/);
});

test('Neural Space 3D keeps existing Studio security boundaries',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [server,scene]=await Promise.all([
    readFile(new URL('nara-core/studio/server.mjs',root),'utf8'),
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8')
  ]);
  assert.match(server,/script-src 'self'/);
  assert.match(server,/\/vendor\/three\/three\.module\.js/);
  assert.doesNotMatch(scene,/fetch\(/);
  assert.doesNotMatch(scene,/EventSource/);
  assert.doesNotMatch(scene,/terminal\.exec/);
});


test('living neural roots use bounded reusable flow packets and organic tubes',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/new THREE\.CatmullRomCurve3/);
  assert.match(scene,/new THREE\.TubeGeometry/);
  assert.match(scene,/function organicCurve\(/);
  assert.match(scene,/animateLinks\(t\)/);
  assert.match(scene,/this\.adjacency=new Map\(\)/);
  assert.match(scene,/this\.packetGeometry=new THREE\.SphereGeometry/);
  assert.match(scene,/setActive\(active\)/);
  assert.doesNotMatch(scene,/this\.packets\.push/);
  assert.doesNotMatch(scene,/setInterval\(/);
});

test('Neural Space Stage 2 highlights selected neighborhood and pauses when hidden',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [scene,app,html]=await Promise.all([
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8')
  ]);

  assert.match(scene,/selectedNeighbors/);
  assert.match(scene,/link\.targetIntensity=link\.selected/);
  assert.match(scene,/energizeRegion\(id,amount=1\)/);
  assert.match(app,/scene\.setActive\(!document\.hidden\)/);
  assert.match(app,/neural3d\?\.setActive\(false\)/);
  assert.match(app,/studioView==='3d'&&!document\.hidden/);
  assert.match(html,/id="neural3dRoots"/);
});


test('Neural Space renderer scripts pass Node syntax checks',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const files=[
    fileURLToPath(new URL('../nara-core/studio/public/neural-space.js',import.meta.url)),
    fileURLToPath(new URL('../nara-core/studio/public/app.js',import.meta.url)),
    fileURLToPath(new URL('../scripts/nara-neural-live-smoke.cjs',import.meta.url))
  ];
  for(const file of files){
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout||file);
  }
});

test('Stage 3 routes semantic events through a bounded shortest-path packet pool',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/const EVENT_ROUTES=Object\.freeze/);
  assert.match(scene,/ROUTE_POOL_SIZE=24/);
  assert.match(scene,/shortestPath\(source,target\)/);
  assert.match(scene,/routeSegments\(nodes\)/);
  assert.match(scene,/acquireRoutePacket\(\)/);
  assert.match(scene,/spawnRoute\(envelope=\{\}\)/);
  assert.match(scene,/for\(let i=0;i<ROUTE_POOL_SIZE;i\+\+\)/);
  assert.match(scene,/'reason\.start':\['NARA_CORE','REASONER'\]/);
  assert.match(scene,/'bug\.detected':\['ERROR_MONITOR','BUG_HUNTER'\]/);
  assert.match(scene,/'verify\.complete':\['FOLLOW_UP','REPORTING'\]/);
});

test('Stage 4 provides focus core explorer modes accessibility and quality controls',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [scene,app,html]=await Promise.all([
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8')
  ]);

  assert.match(scene,/setMode\(mode\)/);
  assert.match(scene,/resetView\(updateMode=true\)/);
  assert.match(scene,/setQuality\(mode='auto'\)/);
  assert.match(scene,/handleKey\(event\)/);
  assert.match(scene,/tabIndex=0/);
  assert.match(scene,/getRegionDetails\(id=/);
  assert.match(app,/neural3d\.setMode|scene\.setMode/);
  assert.match(html,/id="neuralExplorer"/);
  assert.match(html,/id="neuralFocus"/);
  assert.match(html,/id="neuralCore"/);
  assert.match(html,/id="neuralQuality"/);
});

test('Stage 5 uses adaptive cinematic resources and measured performance budgets',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [scene,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(scene,/function makeGlowTexture\(\)/);
  assert.match(scene,/function makeDustField\(/);
  assert.match(scene,/this\.glowTexture=makeGlowTexture\(\)/);
  assert.match(scene,/this\.dust=makeDustField\(\)/);
  assert.match(scene,/samplePerformance\(delta\)/);
  assert.match(scene,/this\.timer=new THREE\.Timer/);
  assert.match(scene,/this\.timer\.update\(\)/);
  assert.match(scene,/this\.timer\.getElapsed\(\)/);
  assert.doesNotMatch(scene,/new THREE\.Clock/);
  assert.match(scene,/state\.fps<38/);
  assert.match(scene,/state\.fps>57/);
  assert.match(scene,/toneMappingExposure/);
  assert.match(styles,/neural3d-vignette/);
  assert.doesNotMatch(scene,/EffectComposer/);
  assert.doesNotMatch(scene,/https?:\/\//);
});


test('Three vendor surface stays fixed to required ESM build modules',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const server=await readFile(new URL('nara-core/studio/server.mjs',root),'utf8');

  assert.match(server,/THREE_VENDOR=Object\.freeze\(new Map/);
  assert.match(server,/\/vendor\/three\/three\.module\.js/);
  assert.match(server,/\/vendor\/three\/three\.core\.js/);
  assert.doesNotMatch(server,/node_modules\/three\/\*\*/);
  assert.doesNotMatch(server,/url\.pathname\.startsWith\('\/vendor\/three\/'\)/);
});


test('Neural renderer lifecycle really pauses hidden work and skips hidden 2D redraws',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [scene,app]=await Promise.all([
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8')
  ]);

  assert.match(scene,/this\.animationLoop=\(\)=>this\.animate\(\)/);
  assert.match(scene,/this\.renderer\.setAnimationLoop\(null\)/);
  assert.match(scene,/this\.timer\.reset\(\)/);
  assert.match(scene,/this\.renderer\.setAnimationLoop\(this\.animationLoop\)/);
  assert.match(app,/if\(studioView==='2d'\)drawBrain\(\)/);
  assert.match(app,/document\.addEventListener\('visibilitychange'/);
  assert.match(app,/studioView==='3d'&&!document\.hidden/);
});

test('Neural live harness separates reproducible CI software GPU from physical GPU acceptance',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [smoke,workflow,pkg,ps1,bat]=await Promise.all([
    readFile(new URL('scripts/nara-neural-live-smoke.cjs',root),'utf8'),
    readFile(new URL('.github/workflows/nara-cloud-verify.yml',root),'utf8'),
    readFile(new URL('package.json',root),'utf8'),
    readFile(new URL('scripts/nara-neural-gpu-acceptance.ps1',root),'utf8'),
    readFile(new URL('NARA-Neural-GPU-Acceptance.bat',root),'utf8')
  ]);

  assert.match(smoke,/NARA_GPU_MODE\|\|'hardware'/);
  assert.match(smoke,/GPU_MODE==='software'/);
  assert.match(smoke,/app\.getGPUInfo\('basic'\)/);
  assert.match(smoke,/app\.getGPUFeatureStatus\(\)/);
  assert.match(smoke,/app\.isHardwareAccelerationEnabled\(\)/);
  assert.match(smoke,/swiftshader\|llvmpipe\|software rasterizer/);
  assert.match(smoke,/report\.checks\.gpuModeMatched/);
  assert.match(workflow,/NARA_GPU_MODE: "software"/);
  assert.match(workflow,/nara-core\/studio\/\*\*/);
  assert.match(workflow,/scripts\/nara-neural-live-smoke\.cjs/);
  assert.match(pkg,/"smoke:neural-gpu": "electron scripts\/nara-neural-live-smoke\.cjs"/);
  assert.match(ps1,/NARA_GPU_MODE = 'hardware'/);
  assert.match(ps1,/gpu\.modeMatched/);
  assert.match(bat,/nara-neural-gpu-acceptance\.ps1/i);
});


test('physical GPU gate trusts the live renderer and treats feature status as advisory',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const smoke=await readFile(new URL('scripts/nara-neural-live-smoke.cjs',root),'utf8');

  assert.match(smoke,/function isSoftwareRenderer\(renderer=''/);
  assert.match(smoke,/function gpuModeMatches\(mode,/);
  assert.match(smoke,/if\(mode==='software'\)return softwareRenderer/);
  assert.match(smoke,/return Boolean\(hardwareAcceleration&&!softwareRenderer\)/);
  assert.match(smoke,/GPUFeatureStatus is only reliable after Chromium's GPU process has initialized/);
  assert.match(smoke,/const featureStatus=app\.getGPUFeatureStatus\(\)/);
  assert.match(smoke,/modeMatched:gpuModeMatches\(GPU_MODE/);
  assert.doesNotMatch(smoke,/hardwareAcceleration&&!softwareRenderer&&featureLooksHardware/);
});

test('Windows physical GPU wrappers use UTF-8 console output',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [ps1,bat]=await Promise.all([
    readFile(new URL('scripts/nara-neural-gpu-acceptance.ps1',root),'utf8'),
    readFile(new URL('NARA-Neural-GPU-Acceptance.bat',root),'utf8')
  ]);
  assert.match(ps1,/\[Console\]::OutputEncoding/);
  assert.match(ps1,/UTF8Encoding/);
  assert.match(bat,/chcp 65001/);
});


test('Windows GPU wrapper reads the acceptance JSON as UTF-8',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const ps1=await readFile(new URL('scripts/nara-neural-gpu-acceptance.ps1',root),'utf8');
  assert.match(ps1,/Get-Content \$reportPath -Raw -Encoding UTF8 \| ConvertFrom-Json/);
});
