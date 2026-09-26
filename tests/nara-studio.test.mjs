import test from 'node:test';
import assert from 'node:assert/strict';
import {createNaraStudioServer,STUDIO_EVENT_ALLOWLIST,buildCreatorRegionMetadata} from '../nara-core/studio/server.mjs';
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


test('Creator Gateway protects Studio APIs with bounded server-side session',async t=>{
  const studio=createNaraStudioServer({
    host:'127.0.0.1',
    port:0,
    creatorAuth:{username:'owner',password:'test-creator-secret',ttlMs:60000}
  });
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  const locked=await fetch(base+'/api/snapshot');
  assert.equal(locked.status,401);

  const initial=await fetch(base+'/api/creator/session').then(r=>r.json());
  assert.equal(initial.configured,true);
  assert.equal(initial.required,true);
  assert.equal(initial.authenticated,false);
  assert.equal(initial.capabilities.find(item=>item.id==='database').state,'locked');

  const wrong=await fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'owner',password:'wrong'})
  });
  assert.equal(wrong.status,401);
  assert.equal(wrong.headers.get('set-cookie'),null);

  const login=await fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'owner',password:'test-creator-secret'})
  });
  assert.equal(login.status,200);
  const cookieHeader=login.headers.get('set-cookie')||'';
  assert.match(cookieHeader,/nara_creator_session=/);
  assert.match(cookieHeader,/HttpOnly/i);
  assert.match(cookieHeader,/SameSite=Strict/i);
  const loginBody=await login.json();
  assert.equal(loginBody.authenticated,true);
  assert.equal('token' in loginBody,false);
  assert.equal(JSON.stringify(loginBody).includes('test-creator-secret'),false);

  const cookie=cookieHeader.split(';')[0];
  const sessionRes=await fetch(base+'/api/creator/session',{headers:{cookie}});
  assert.equal(sessionRes.status,200);
  const session=await sessionRes.json();
  assert.equal(session.authenticated,true);
  assert.equal(session.username,'owner');
  assert.equal(session.capabilities.find(item=>item.id==='camera').state,'permission_required');
  assert.equal(session.capabilities.find(item=>item.id==='database').state,'not_configured');

  const snapshot=await fetch(base+'/api/snapshot',{headers:{cookie}});
  assert.equal(snapshot.status,200);

  const allowed=await fetch(base+'/api/event',{
    method:'POST',
    headers:{'content-type':'application/json',cookie},
    body:JSON.stringify({event:'reason.start',payload:{label:'Creator test'}})
  });
  assert.equal(allowed.status,200);

  const denied=await fetch(base+'/api/event',{
    method:'POST',
    headers:{'content-type':'application/json',cookie},
    body:JSON.stringify({event:'terminal.exec',payload:{command:'whoami'}})
  });
  assert.equal(denied.status,403);

  const logout=await fetch(base+'/api/creator/logout',{
    method:'POST',
    headers:{'content-type':'application/json',cookie},
    body:'{}'
  });
  assert.equal(logout.status,200);
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/i);

  const relocked=await fetch(base+'/api/snapshot',{headers:{cookie}});
  assert.equal(relocked.status,401);
});

test('Creator Gateway rate-limits failed authentication attempts',async t=>{
  const studio=createNaraStudioServer({
    host:'127.0.0.1',
    port:0,
    creatorAuth:{username:'creator',password:'rate-secret',maxAttempts:2,attemptWindowMs:60000}
  });
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;
  const attempt=()=>fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'creator',password:'wrong'})
  });

  assert.equal((await attempt()).status,401);
  assert.equal((await attempt()).status,401);
  assert.equal((await attempt()).status,429);
});

test('required Creator auth without a configured password fails closed',async t=>{
  const studio=createNaraStudioServer({
    host:'127.0.0.1',
    port:0,
    creatorAuth:{required:true}
  });
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  const session=await fetch(base+'/api/creator/session').then(r=>r.json());
  assert.equal(session.required,true);
  assert.equal(session.misconfigured,true);
  assert.equal(session.authenticated,false);
  assert.equal((await fetch(base+'/api/snapshot')).status,401);

  const login=await fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'creator',password:'anything'})
  });
  assert.equal(login.status,503);
});

test('Creator Gateway UI defers Studio boot and uses browser permission APIs without storing secrets',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,gateway,styles,server,auth]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/creator-gateway.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8'),
    readFile(new URL('nara-core/studio/server.mjs',root),'utf8'),
    readFile(new URL('nara-core/studio/creator-auth.mjs',root),'utf8')
  ]);

  assert.match(html,/id="creatorGateway"/);
  assert.match(html,/id="creatorLoginForm"/);
  assert.match(html,/id="creatorPassword"/);
  assert.match(html,/id="creatorCapabilityRows"/);
  assert.match(app,/import \{initializeCreatorGateway\} from '\.\/creator-gateway\.js'/);
  assert.match(app,/startStudioAfterCreatorAccess/);
  assert.match(gateway,/navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(gateway,/getUserMedia\(\{video:true,audio:true\}\)/);
  assert.match(gateway,/for\(const track of stream\.getTracks\(\)\)track\.stop\(\)/);
  assert.doesNotMatch(gateway,/localStorage|sessionStorage/);
  assert.match(styles,/Creator Gateway — Stage 1/);
  assert.match(server,/HttpOnly|sessionCookie/);
  assert.match(server,/frame-ancestors 'none'/);
  assert.match(auth,/timingSafeEqual/);
  assert.match(auth,/randomBytes\(32\)/);
  assert.match(auth,/not_configured/);
});

test('Creator Gateway modules pass Node syntax checks',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const files=[
    fileURLToPath(new URL('../nara-core/studio/creator-auth.mjs',import.meta.url)),
    fileURLToPath(new URL('../nara-core/studio/public/creator-gateway.js',import.meta.url))
  ];
  for(const file of files){
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout||file);
  }
});


test('Stage 2 edge HUD makes Neural Space the fullscreen primary surface',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,edge,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/edge-hud.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(html,/id="edgeHud"/);
  for(const mode of ['connection','loading','error','progress','evolution','damage']){
    assert.match(html,new RegExp('data-edge-monitor="'+mode+'"'));
    assert.match(edge,new RegExp("'"+mode+"'"));
  }
  assert.match(app,/import \{createEdgeHud\} from '\.\/edge-hud\.js'/);
  assert.match(app,/edgeHud\.activate\(\)/);
  assert.match(app,/setStudioView\('3d'\)/);
  assert.match(app,/edgeHud\.update\(\{snapshot:state\}\)/);
  assert.match(app,/edgeHud\.update\(\{telemetry\}\)/);
  assert.match(styles,/Edge HUD — Stage 2/);
  assert.match(styles,/\.creator-session-active \.panel:not\(\.brain-panel\)\{display:none\}/);
  assert.match(styles,/\.creator-session-active \.brain-stage\{height:100vh\}/);
  assert.doesNotMatch(edge,/innerHTML\s*=/);
});

test('edge HUD module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/edge-hud.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('Stage 3 cinematic entry uses local bounded audio and Indonesian NARA voice',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,gateway,entry,sound,matrix,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/creator-gateway.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/neural-entry.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/cinematic-sound.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/matrix-transition.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(html,/id="neuralEntryTransition"/);
  assert.match(html,/id="edgeAudioToggle"/);
  assert.match(gateway,/onEntering=\(\)=>\{\}/);
  assert.match(gateway,/onEntering\(session\)/);
  assert.match(app,/createNeuralEntryExperience/);
  assert.match(app,/onEntering:\(\)=>neuralEntry\.play/);
  assert.match(sound,/AudioContext=window\.AudioContext/);
  assert.match(sound,/createOscillator\(\)/);
  assert.match(matrix,/fillText\(bit/);
  assert.match(entry,/SpeechSynthesisUtterance/);
  assert.match(entry,/NARA Core online/);
  assert.match(entry,/id-ID/);
  assert.match(entry,/prefers-reduced-motion/);
  assert.doesNotMatch(entry,/https?:\/\//);
  assert.doesNotMatch(entry,/fetch\(/);
  assert.match(styles,/Neural Entry — Stage 3/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Neural entry module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/neural-entry.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('Stage 4 uses bounded galactic brain and aurora geometry with adaptive quality',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/function makeGalacticBrainFrame\(\)/);
  assert.match(scene,/function makeAuroraRibbon\(/);
  assert.match(scene,/function makeAuroraField\(\)/);
  assert.match(scene,/function makeNebulaField\(/);
  assert.match(scene,/function disposeDecorativeGroup\(/);
  assert.match(scene,/for\(let band=0;band<6;band\+\+\)/);
  assert.match(scene,/const segments=36/);
  assert.match(scene,/high:\{pixel:1\.8,scale:1,fog:\.028,dust:true,aurora:true,nebula:true/);
  assert.match(scene,/low:\{pixel:1,scale:\.55,fog:\.036,dust:false,aurora:false,nebula:false/);
  assert.match(scene,/recenterHomeView\(\)/);
  assert.match(scene,/new THREE\.Box3\(\)/);
  assert.match(scene,/galacticFrame:Boolean\(this\.galacticFrame\?\.visible\)/);
  assert.match(scene,/aurora:Boolean\(this\.aurora\?\.visible\)/);
  assert.match(scene,/disposeDecorativeGroup\(this\.galacticFrame\)/);
  assert.match(scene,/disposeDecorativeGroup\(this\.aurora\)/);
  assert.doesNotMatch(scene,/EffectComposer|UnrealBloomPass|ShaderMaterial/);
  assert.doesNotMatch(scene,/https?:\/\//);
});

test('Stage 4 reduces idle root clutter while preserving active route emphasis',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/link\.targetIntensity=link\.selected\?1:link\.active\?\.72:\.032/);
  assert.match(scene,/link\.sheath\.material\.opacity=\(\.024\+energy\*\.142/);
  assert.match(scene,/const visible=energy>\.20\|\|link\.selected\|\|link\.active/);
  assert.match(scene,/new THREE\.SphereGeometry\(\.88,36,26\)/);
  assert.match(scene,/const haloSize=isCore\?3\.50:2\.05/);
});


test('Stage 4 fullscreen polish hides legacy Neural cards and keeps controls edge-like',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const styles=await readFile(new URL('nara-core/studio/public/styles.css',root),'utf8');
  assert.match(styles,/\.creator-session-active \.neural3d-detail,\s*\n\.creator-session-active \.neural3d-hud\{display:none\}/);
  assert.match(styles,/\.creator-session-active \.neural3d-toolbar\{/);
  assert.match(styles,/left:50%;right:auto;top:58px;transform:translateX\(-50%\)/);
});


test('Creator node metadata is an explicit safe projection without secrets or private reasoning',()=>{
  const metadata=buildCreatorRegionMetadata({
    id:'MEMORY',
    host:'127.0.0.1',
    port:4178,
    state:{
      lifecycle:'active',
      regions:{
        MEMORY:{status:'active',lastEvent:'memory.read'},
        NARA_CORE:{status:'ready'}
      }
    },
    telemetry:{
      performance:{totalEvents:12,eventsPerSecond:1.2},
      diagnostics:{status:'verified',counters:{errors:1,bugs:1,fixed:1,verified:1}},
      memory:{counters:{read:4,write:2,context_used:3,context_blocked:1}}
    },
    skills:{skills:[{id:'memory.read',label:'Memory Read',region:'MEMORY',status:'complete',runs:4,successes:4,failures:0,lastEvent:'memory.read',lastDurationMs:12}]}
  });

  assert.equal(metadata.id,'MEMORY');
  assert.equal(metadata.network.scope,'loopback');
  assert.equal(metadata.network.address,'127.0.0.1');
  assert.equal(metadata.network.port,4178);
  assert.equal(metadata.network.discovery,'disabled');
  assert.equal(metadata.database.state,'not_configured');
  assert.equal(metadata.database.credentials,'not_exposed');
  assert.equal(metadata.security.permissionBypass,false);
  assert.equal(metadata.security.arbitraryNetworkDiscovery,false);
  assert.equal(metadata.security.rawSecretsExposed,false);
  assert.equal(metadata.security.privateReasoningExposed,false);
  assert.equal('message' in metadata,false);
  assert.equal('environment' in metadata,false);
  assert.equal('token' in metadata,false);
  assert.equal('password' in metadata,false);
  assert.equal(metadata.skills[0].runs,4);
});

test('Creator region metadata endpoint is auth-protected and rejects unknown regions',async t=>{
  const secret='node-inspector-test-secret';
  const studio=createNaraStudioServer({
    host:'127.0.0.1',
    port:0,
    creatorAuth:{username:'owner',password:secret,ttlMs:60000}
  });
  t.after(()=>studio.stop());
  const address=await studio.start();
  const base='http://127.0.0.1:'+address.port;

  assert.equal((await fetch(base+'/api/creator/region/MEMORY')).status,401);

  const login=await fetch(base+'/api/creator/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'owner',password:secret})
  });
  assert.equal(login.status,200);
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];

  const response=await fetch(base+'/api/creator/region/MEMORY',{headers:{cookie}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.equal(data.region.id,'MEMORY');
  assert.equal(data.region.network.address,'127.0.0.1');
  assert.equal(data.region.network.port,address.port);
  assert.equal(data.region.server.secrets,'redacted');
  assert.equal(data.region.database.credentials,'not_exposed');
  assert.equal(JSON.stringify(data).includes(secret),false);

  const missing=await fetch(base+'/api/creator/region/NOT_A_REGION',{headers:{cookie}});
  assert.equal(missing.status,404);
});

test('Stage 5 node inspector renders server metadata with textContent and no HTML injection surface',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,inspector,styles,server]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/node-inspector.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8'),
    readFile(new URL('nara-core/studio/server.mjs',root),'utf8')
  ]);

  assert.match(html,/id="neuralNodeInspector"/);
  assert.match(html,/id="nodeInspectorBody"/);
  assert.match(app,/createNodeInspector/);
  assert.match(app,/await nodeInspector\.open\(region\)/);
  assert.match(app,/await nodeInspector\.open\(region\.id\)/);
  assert.match(inspector,/\/api\/creator\/region\//);
  assert.match(inspector,/textContent=/);
  assert.match(inspector,/replaceChildren/);
  assert.doesNotMatch(inspector,/innerHTML/);
  assert.doesNotMatch(inspector,/localStorage|sessionStorage/);
  assert.match(inspector,/NETWORK \/ SERVER/);
  assert.match(inspector,/DATABASE/);
  assert.match(inspector,/SECURITY BOUNDARY/);
  assert.match(styles,/Neural Node Inspector — Stage 5/);
  assert.match(server,/buildCreatorRegionMetadata/);
  assert.doesNotMatch(server,/process\.env\[[^\]]+\].*metadata/);
});

test('node inspector module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/node-inspector.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('Stage 6 spoken summary is bounded operational metadata only',async()=>{
  const {buildOperationalNarration}=await import('../nara-core/studio/public/node-voice.js');
  const narration=buildOperationalNarration({
    id:'MEMORY',
    label:'Memory',
    group:'cognitive',
    status:'active',
    lastEvent:'memory.read',
    neighbors:[{id:'NARA_CORE',label:'NARA Core'},{id:'DRIVE',label:'Drive'}],
    runtime:{lifecycle:'active',activeRegions:4,totalEvents:19,eventsPerSecond:1.2},
    network:{scope:'loopback',address:'127.0.0.1',port:4178},
    server:{health:'online',secrets:'DO_NOT_SPEAK_SERVER_SECRET'},
    database:{state:'not_configured',credentials:'DO_NOT_SPEAK_DB_SECRET'},
    diagnostics:{errors:1,bugs:2,fixed:2,verified:1},
    memory:{reads:7,writes:3},
    skills:[{id:'memory.read',label:'Memory Read',status:'complete',runs:7,successes:7,failures:0}],
    security:{privateReasoningExposed:false},
    privateReasoning:'DO_NOT_SPEAK_PRIVATE_REASONING'
  });

  assert.match(narration,/Memory\. Status active\./);
  assert.match(narration,/127\.0\.0\.1 port 4178/);
  assert.match(narration,/Database .* belum dikonfigurasi/);
  assert.match(narration,/1 error, 2 bug, 2 perbaikan, dan 1 verifikasi/);
  assert.match(narration,/7 pembacaan dan 3 penulisan/);
  assert.match(narration,/Credential, secret, dan private reasoning tidak ditampilkan/);
  assert.equal(narration.includes('DO_NOT_SPEAK_SERVER_SECRET'),false);
  assert.equal(narration.includes('DO_NOT_SPEAK_DB_SECRET'),false);
  assert.equal(narration.includes('DO_NOT_SPEAK_PRIVATE_REASONING'),false);
  assert.ok(narration.length<=1100);
});

test('Stage 6 node voice is local, audio-gated and wired to sanitized inspector metadata',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,voice,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/node-voice.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(html,/id="nodeInspectorSpeak"/);
  assert.match(html,/id="nodeInspectorVoiceText"/);
  assert.match(app,/import \{createNodeVoice\} from '\.\/node-voice\.js'/);
  assert.match(app,/onMetadata:metadata=>nodeVoice\.speak\(metadata\)/);
  assert.match(voice,/SpeechSynthesisUtterance/);
  assert.match(voice,/edgeAudioToggle/);
  assert.match(voice,/speechSynthesis\.cancel\(\)/);
  assert.match(voice,/speechSynthesis\.speak\(utterance\)/);
  assert.match(voice,/id-ID/);
  assert.doesNotMatch(voice,/fetch\(|EventSource|https?:\/\//);
  assert.match(styles,/NARA Node Voice — Stage 6/);
});

test('node voice module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/node-voice.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('realtime smoke authenticates through configured Creator Gateway before entering Neural Space',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const smoke=await readFile(new URL('scripts/nara-neural-live-smoke.cjs',root),'utf8');

  assert.match(smoke,/const SMOKE_CREATOR=Object\.freeze/);
  assert.match(smoke,/password:'browser-acceptance-'\+process\.pid/);
  assert.match(smoke,/creatorAuth:SMOKE_CREATOR/);
  assert.match(smoke,/creatorLoginForm/);
  assert.match(smoke,/form\.requestSubmit\(\)/);
  assert.match(smoke,/creatorLoginAuthenticated/);
  assert.match(smoke,/creatorSecureSession/);
  assert.match(smoke,/CREATOR VERIFIED/);
  assert.match(smoke,/SECURE SESSION/);
  assert.doesNotMatch(smoke,/report\.SMOKE_CREATOR/);
  assert.doesNotMatch(smoke,/report\.creatorPassword/);
});


test('Revision R1 Creator login uses animated neural binary brain with reduced-motion support',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,gateway,brain,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/creator-gateway.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/creator-brain.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(html,/id="creatorBrainCanvas"/);
  assert.match(html,/NEURAL IDENTITY MATRIX/);
  assert.match(gateway,/import \{createCreatorBrainBackdrop\} from '\.\/creator-brain\.js'/);
  assert.match(gateway,/brain\.setState\('verifying'\)/);
  assert.match(gateway,/brain\.setState\('verified'\)/);
  assert.match(gateway,/brain\.setState\('error'\)/);
  assert.match(brain,/function brainMask\(/);
  assert.match(brain,/createNodes\(random/);
  assert.match(brain,/createLinks\(nodes\)/);
  assert.match(brain,/createBits\(random/);
  assert.match(brain,/fillText\(bit\.value/);
  assert.match(brain,/prefers-reduced-motion/);
  assert.doesNotMatch(brain,/fetch\(|EventSource|https?:\/\//);
  assert.match(styles,/Revision R1 — Creator Neural Binary Gate/);
  assert.match(styles,/\.creator-brain-canvas/);
  assert.match(styles,/\.creator-gateway-card/);
});

test('Creator brain module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/creator-brain.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('Revision R2 sequences sweep zoom process pulse and flow with bounded local audio',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,entry,sound,matrix,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/neural-entry.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/cinematic-sound.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/matrix-transition.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);
  assert.match(html,/id="neuralEntryMatrix"/);
  assert.match(html,/neural-entry-warp/);
  assert.match(entry,/MATRIX GATE OPENING/);
  for(const cue of ['sweep','zoomIn','pulse','process','flow','zoomOut']){
    assert.match(entry,new RegExp(cue));
    assert.match(sound,new RegExp("name==='"+cue+"'"));
  }
  assert.match(entry,/const total=motionReduced\?1050:\(compact\?1850:3600\)/);
  assert.match(entry,/matrix\.start\(\{compact\}\)/);
  assert.match(entry,/matrix\.burst\(\)/);
  assert.match(entry,/sound\.cue\(item\[2\]\)/);
  assert.match(matrix,/prefers-reduced-motion/);
  assert.match(sound,/master\.gain\.value=\.055/);
  assert.doesNotMatch(sound,/fetch\(|EventSource|https?:\/\//);
  assert.doesNotMatch(matrix,/fetch\(|EventSource|https?:\/\//);
  assert.match(styles,/Revision R2 — Smooth Matrix Gate/);
});

test('R2 cinematic sound and matrix modules pass Node syntax checks',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  for(const relative of ['../nara-core/studio/public/cinematic-sound.js','../nara-core/studio/public/matrix-transition.js']){
    const file=fileURLToPath(new URL(relative,import.meta.url));
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout||file);
  }
});


test('Revision R3 gives NARA Core two counter-rotating mechanical rings and layered gradient energy',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [scene,app]=await Promise.all([
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8')
  ]);

  assert.match(scene,/function makeCoreMechanicalSystem\(\)/);
  assert.match(scene,/new THREE\.TorusGeometry\(1\.34/);
  assert.match(scene,/new THREE\.TorusGeometry\(1\.54/);
  assert.match(scene,/for\(let index=0;index<12;index\+\+\)/);
  assert.match(scene,/for\(let index=0;index<14;index\+\+\)/);
  assert.match(scene,/ringA\.rotation\.z\+=delta\*\.52\*motion/);
  assert.match(scene,/ringB\.rotation\.z-=delta\*\.67\*motion/);
  assert.match(scene,/entry\.mesh\.material\.color\.setHSL\(hue/);
  assert.match(scene,/entry\.halo\.material\.color\.setHSL/);
  assert.match(scene,/mechanicalCore:Boolean\(this\.nodes\.get\('NARA_CORE'\)\?\.coreFx\)/);
  assert.match(scene,/disposeDecorativeGroup\(entry\.coreFx\)/);
  assert.match(app,/core rings /);
});

test('R3 mechanical Core remains shader-free and bounded',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');
  assert.doesNotMatch(scene,/ShaderMaterial|EffectComposer|UnrealBloomPass/);
  assert.equal((scene.match(/new THREE\.TorusGeometry/g)||[]).length,2);
  assert.match(scene,/coreFx=isCore\?makeCoreMechanicalSystem\(\):null/);
});


test('Revision R4 Creator control center stores visual preferences only and drives realtime renderer settings',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const [html,app,settings,scene,styles]=await Promise.all([
    readFile(new URL('nara-core/studio/public/index.html',root),'utf8'),
    readFile(new URL('nara-core/studio/public/app.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/custom-settings.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8'),
    readFile(new URL('nara-core/studio/public/styles.css',root),'utf8')
  ]);

  assert.match(html,/id="edgeCustomSettings"/);
  assert.match(html,/id="customSettingsPanel"/);
  assert.match(html,/data-visual-setting="brainFrame"/);
  assert.match(html,/data-visual-setting="binary"/);
  assert.match(html,/data-visual-setting="ringSpeedA"/);
  assert.match(html,/data-visual-setting="ringSpeedB"/);
  assert.match(html,/data-visual-preset="neural-galaxy"/);
  assert.match(html,/Visual preferences only · no credentials stored/);

  assert.match(app,/createCustomSettingsPanel/);
  assert.match(app,/applyVisualSettings\?\.\(customSettings\.getSettings\(\)\)/);
  assert.match(app,/binary '\+\(stats\.brainBinary\?'on':'off'\)/);
  assert.match(app,/guardian '\+\(stats\.guardianRingA\?'A':'-'\)/);

  assert.match(settings,/const STORAGE_KEY='nara\.visual\.settings\.v1'/);
  assert.match(settings,/sanitizeVisualSettings/);
  assert.match(settings,/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(settings\)\)/);
  assert.match(settings,/frameGlow:\[\.35,2\]/);
  assert.match(settings,/ringSpeedA:\[\.15,2\.2\]/);
  assert.match(settings,/quality:'auto'/);
  assert.doesNotMatch(settings,/password|api[_-]?key|access[_-]?token|bearer/i);

  assert.match(scene,/applyVisualSettings\(settings=\{\}\)/);
  assert.match(scene,/refreshVisualVisibility\(\)/);
  assert.match(scene,/guardianRingA:/);
  assert.match(scene,/guardianRingB:/);
  assert.match(styles,/Revision R4\.1 — Creator Custom Visual Control Center/);
  assert.match(styles,/\.custom-settings-panel/);
});

test('Revision R4 strengthens dark-room brain frame, binary lattice, aurora and broken living roots',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/function addFrameLine\(/);
  assert.match(scene,/role:'glow'/);
  assert.match(scene,/baseOpacity:\.20\+\(band%3\)\*\.025/);
  assert.match(scene,/function makeBrainBinaryField\(\)/);
  assert.match(scene,/for\(let index=0;index<52;index\+\+\)/);
  assert.match(scene,/makeBinaryGlyphTexture\('0'\)/);
  assert.match(scene,/makeBinaryGlyphTexture\('1'\)/);
  assert.match(scene,/new THREE\.CurvePath\(\)/);
  assert.match(scene,/new THREE\.LineCurve3/);
  assert.match(scene,/const radius=Math\.min\(\.068,Math\.max\(\.032/);
  assert.match(scene,/visual\.rootGlow/);
  assert.match(scene,/visualSettings\.auroraIntensity/);
  assert.match(scene,/brainBinary\.visible=visual\.brainFrame&&visual\.binary/);
});

test('Revision R4 guardian emblem has counter-rotation plus bounded precession',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');

  assert.match(scene,/guardianBladeA/);
  assert.match(scene,/guardianBladeB/);
  assert.match(scene,/ringA\.userData=\{baseX:ringA\.rotation\.x,baseY:ringA\.rotation\.y\}/);
  assert.match(scene,/ringB\.userData=\{baseX:ringB\.rotation\.x,baseY:ringB\.rotation\.y\}/);
  assert.match(scene,/ringA\.rotation\.z\+=delta\*\.52\*motion\*visual\.ringSpeedA/);
  assert.match(scene,/ringB\.rotation\.z-=delta\*\.67\*motion\*visual\.ringSpeedB/);
  assert.match(scene,/ringA\.rotation\.x=fx\.ringA\.userData\.baseX\+Math\.sin/);
  assert.match(scene,/ringB\.rotation\.y=fx\.ringB\.userData\.baseY-Math\.cos/);
  assert.equal((scene.match(/new THREE\.TorusGeometry/g)||[]).length,2);
  assert.doesNotMatch(scene,/ShaderMaterial|EffectComposer|UnrealBloomPass/);
});

test('R4 custom settings module passes Node syntax check',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const file=fileURLToPath(new URL('../nara-core/studio/public/custom-settings.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||file);
});


test('R4 guardian torus thickness remains bounded while brighter in dark scenes',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=new URL('../',import.meta.url);
  const scene=await readFile(new URL('nara-core/studio/public/neural-space.js',root),'utf8');
  assert.match(scene,/new THREE\.TorusGeometry\(1\.34,\.055,8,64\)/);
  assert.match(scene,/new THREE\.TorusGeometry\(1\.54,\.050,8,64\)/);
  assert.match(scene,/frameGlow:1\.45/);
  assert.match(scene,/auroraIntensity:1\.35/);
});
