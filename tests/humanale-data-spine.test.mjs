import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
let nonce=0;

async function createRuntime(){
  delete globalThis.NeuralCore;
  delete globalThis.HumanALEAleRuntime;
  await import('../sites/humanale-hologram/dist/neural-core.js?phase7='+ ++nonce);
  await import('../sites/humanale-hologram/dist/alecore-ai-runtime.js?phase7='+ ++nonce);
  const graph=globalThis.NeuralCore.create();
  const runtime=globalThis.HumanALEAleRuntime.create({regions:graph.regions});
  return {graph,runtime};
}

async function loadDataSpine(){
  delete globalThis.HumanALEDataSpine;
  await import('../sites/humanale-hologram/dist/alecore-ai-data-spine.js?phase7='+ ++nonce);
  return globalThis.HumanALEDataSpine;
}

async function loadConnections(){
  delete globalThis.HumanALEConnections;
  await import('../sites/humanale-hologram/dist/alecore-ai-connections.js?phase7='+ ++nonce);
  return globalThis.HumanALEConnections;
}

test('Data Spine geometry and event engine share the same nine canonical lanes',async()=>{
  const {graph,runtime}=await createRuntime();
  const DataSpine=await loadDataSpine();
  const geometry=graph.spineLanes.map(({id,region})=>({id,region}));
  const engine=DataSpine.lanes.map(({id,region})=>({id,region}));
  assert.deepEqual(geometry,engine);
  assert.deepEqual(geometry.map(item=>item.id),[
    'CORE','MEMORY','TERMINAL','GITHUB','COPILOT','WEB','DRIVE','SYNC','ERROR'
  ]);
  assert.equal(graph.paths.length,9);
  for(let i=0;i<graph.paths.length;i++){
    const meta=graph.spineLanes[i];
    const ids=graph.paths[i];
    assert.ok(ids.length>=2);
    for(const id of ids){
      const node=graph.nodes[id];
      assert.equal(node.region,'stem');
      assert.equal(node.laneId,meta.id);
      assert.equal(node.targetRegion,meta.region);
    }
  }
  assert.ok(runtime);
});

test('Data Spine packets are created by real events and never copy raw payload secrets',async()=>{
  const {runtime}=await createRuntime();
  const DataSpine=await loadDataSpine();
  let clock=1000;
  const states=[];
  const spine=DataSpine.create({runtime,now:()=>clock,onState:state=>states.push(state)});
  spine.start();
  runtime.start();
  runtime.dispatch('github.connected',{token:'NEVER_RENDER_THIS',path:'C:/private/file'});
  let snapshot=spine.snapshot();
  const github=snapshot.packets.filter(packet=>packet.laneId==='GITHUB').at(-1);
  assert.ok(github);
  assert.equal(github.event,'github.connected');
  assert.equal(github.glyph,'<>');
  assert.equal(github.direction,'up');
  assert.equal(snapshot.lanes.GITHUB.status,'connected');
  const serialized=JSON.stringify(snapshot);
  assert.equal(serialized.includes('NEVER_RENDER_THIS'),false);
  assert.equal(serialized.includes('C:/private/file'),false);
  assert.equal(serialized.includes('"token"'),false);

  runtime.dispatch('brain.region.select',{region:'GITHUB'});
  assert.equal(runtime.snapshot().regions.GITHUB.status,'connected','selection must preserve connection state');

  runtime.dispatch('github.disconnected',{reason:'private backend detail'});
  snapshot=spine.snapshot();
  const down=snapshot.packets.filter(packet=>packet.laneId==='GITHUB').at(-1);
  assert.equal(down.direction,'down');
  assert.equal(snapshot.lanes.GITHUB.status,'disconnected');
  assert.equal(JSON.stringify(snapshot).includes('private backend detail'),false);

  clock+=7000;
  assert.equal(spine.snapshot().packets.length,0);
  spine.stop();
  assert.ok(states.length>0);
});

test('connection monitor uses real browser network state and sanitized provider status only',async()=>{
  const {runtime}=await createRuntime();
  const Connections=await loadConnections();
  const listeners={};
  const eventTarget={
    addEventListener(name,fn){listeners[name]=fn;},
    removeEventListener(name,fn){if(listeners[name]===fn)delete listeners[name];}
  };
  const navigatorObj={onLine:true};
  const reply={
    version:1,signedIn:true,
    connections:{web:'connected',github:'connected',copilot:'login_required',drive:'unknown'},
    ignoredSecret:'SHOULD_NOT_SURVIVE'
  };
  const fetchCalls=[];
  const fetchImpl=async(url,options)=>{
    fetchCalls.push({url,options});
    return{ok:true,status:200,json:async()=>reply};
  };
  const oldSetInterval=globalThis.setInterval,oldClearInterval=globalThis.clearInterval;
  let scheduled=null,cleared=null;
  globalThis.setInterval=(fn,ms)=>{scheduled={fn,ms};return 44;};
  globalThis.clearInterval=id=>{cleared=id;};
  try{
    const monitor=Connections.create({runtime,fetchImpl,navigatorObj,eventTarget,intervalMs:5000});
    monitor.start();
    await monitor.refresh();
    let brain=runtime.snapshot();
    assert.equal(brain.regions.WEB.status,'connected');
    assert.equal(brain.regions.ONLINE.status,'connected');
    assert.equal(brain.regions.GITHUB.status,'connected');
    assert.equal(brain.regions.COPILOT.status,'login_required');
    assert.equal(brain.regions.DRIVE.status,'idle');
    assert.equal(monitor.snapshot().authStatus,'connected');
    assert.equal(fetchCalls.at(-1).url,'/api/status');
    assert.equal(fetchCalls.at(-1).options.credentials,'same-origin');
    assert.equal(scheduled.ms,5000);
    assert.equal(JSON.stringify(monitor.snapshot()).includes('SHOULD_NOT_SURVIVE'),false);

    navigatorObj.onLine=false;
    listeners.offline();
    brain=runtime.snapshot();
    assert.equal(brain.regions.WEB.status,'disconnected');
    assert.equal(brain.regions.ONLINE.status,'disconnected');

    monitor.stop();
    assert.equal(cleared,44);
    assert.equal(listeners.online,undefined);
    assert.equal(listeners.offline,undefined);
  }finally{
    globalThis.setInterval=oldSetInterval;
    globalThis.clearInterval=oldClearInterval;
  }
});

test('site status API exposes booleans and statuses but not authenticated email value',async()=>{
  const {handleAPI}=await import('../worker.mjs?phase7='+ ++nonce);
  const email='private-owner@example.test';
  const request=new Request('https://humanale.example/api/status',{headers:{'oai-authenticated-user-email':email}});
  const response=await handleAPI(request);
  assert.equal(response.ok,true);
  const data=await response.json();
  assert.equal(data.version,1);
  assert.equal(data.signedIn,true);
  assert.equal(data.connections.web,'connected');
  assert.equal(JSON.stringify(data).includes(email),false);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('canonical site wires Data Spine live connections and inspector without privileged data',async()=>{
  const [html,site,avatar,spine,connections]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/avatar.js'),
    read('sites/humanale-hologram/dist/alecore-ai-data-spine.js'),
    read('sites/humanale-hologram/dist/alecore-ai-connections.js')
  ]);
  assert.match(html,/\.\/alecore-ai-data-spine\.js/);
  assert.match(html,/\.\/alecore-ai-connections\.js/);
  assert.match(html,/id="connectionGrid"/);
  assert.match(html,/id="regionInspector"/);
  assert.match(site,/HumanALEDataSpine\.create/);
  assert.match(site,/avatar\.setDataSpineState/);
  assert.match(site,/HumanALEConnections\.create/);
  assert.match(site,/dataSpine\.start\(\)/);
  assert.match(site,/connections\.start\(\)/);
  assert.match(site,/dataSpine\.stop\(\)/);
  assert.match(site,/connections\.stop\(\)/);
  assert.match(avatar,/setDataSpineState\(snapshot = \{\}\)/);
  assert.match(avatar,/graph\.spineLanes/);
  assert.doesNotMatch(avatar,/for \(let packet = 0; packet < 5; packet\+\+\)/);
  assert.doesNotMatch(spine,/OPENAI_API_KEY|GITHUB_TOKEN|process\.env|password/i);
  assert.doesNotMatch(connections,/OPENAI_API_KEY|GITHUB_TOKEN|process\.env|password/i);
});

test('core BrainState preserves connected status on visual selection and supports ONLINE events',async()=>{
  const {createBrainState}=await import('../ALECORE-AI/brain/brain-state.js?phase7='+ ++nonce);
  const state=createBrainState();
  state.applyEvent({id:1,event:'github.connected',timestamp:1,payload:{}});
  state.applyEvent({id:2,event:'brain.region.select',timestamp:2,payload:{region:'GITHUB'}});
  assert.equal(state.snapshot().regions.GITHUB.status,'connected');
  state.applyEvent({id:3,event:'online.connected',timestamp:3,payload:{}});
  assert.equal(state.snapshot().regions.ONLINE.status,'connected');
  state.applyEvent({id:4,event:'online.disconnected',timestamp:4,payload:{}});
  assert.equal(state.snapshot().regions.ONLINE.status,'disconnected');
});
