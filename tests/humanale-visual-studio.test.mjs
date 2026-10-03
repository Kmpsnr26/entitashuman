import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHumanALEVisualStudio,HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY,HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY} from '../public/humanale-visual-studio.js';

const root=new URL('../',import.meta.url);

async function visualTestRuntime(overrides={}){
 const app=await readFile(new URL('public/app.js',root),'utf8');
 const functions=['runHumanALEVisualTest','handleHumanALEVisualTestMessage','drainNaraVoiceQueue'].map(name=>{
  const source=app.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'))?.[0];
  assert.ok(source,name+' missing');return source;
 }).join('\n');
 const context={
  desktop:{naraTestScenario:async()=>({ok:true,restored:true})},
  panelOnly:false,panelChannel:null,pendingVisualTests:new Map(),visualTestRequestSequence:0,
  activeSpeechSource:'',naraVisualTestActive:false,naraVoiceDrainTimer:null,naraVoiceActive:false,
  naraVoiceQueue:[{text:'NARA cue'}],voice:true,Date,setTimeout,clearTimeout,
  naraSpeechBusy:()=>false,stopSpeech:()=>{},naraDispatch:async()=>({ok:true}),
  syncNaraBrainState:()=>{},scheduleNaraVoiceDrain:()=>{},speak:()=>true,...overrides
 };
 runInNewContext(functions,context);
 return context;
}

test('controlled test cancels pending automatic narration and holds voice cues until restoration',async()=>{
 const events=[];
 let finish;
 let runtime;
 runtime=await visualTestRuntime({
  activeSpeechSource:'nara',naraSpeechBusy:()=>true,
  stopSpeech:()=>{events.push('cancel-narration');runtime.activeSpeechSource='';},
  naraDispatch:async event=>{events.push(event);},
  desktop:{naraTestScenario:async()=>{events.push('start-test');return new Promise(resolve=>{finish=resolve;});}},
  scheduleNaraVoiceDrain:()=>events.push('resume-narration'),
  speak:()=>{events.push('speak');return true;}
 });
 const pending=runtime.runHumanALEVisualTest('thinking');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['cancel-narration','speech.stop','start-test']);
 assert.equal(runtime.naraVisualTestActive,true);
 runtime.drainNaraVoiceQueue();
 assert.equal(runtime.naraVoiceQueue.length,1);
 assert.equal(events.includes('speak'),false);
 finish({ok:true,restored:true});
 assert.equal((await pending).restored,true);
 assert.equal(runtime.naraVisualTestActive,false);
 assert.equal(events.at(-1),'resume-narration');
});

test('controlled test preserves assistant speech and releases narration hold after failure',async()=>{
 const events=[];
 const runtime=await visualTestRuntime({
  activeSpeechSource:'assistant',naraSpeechBusy:()=>true,
  stopSpeech:()=>events.push('cancel'),desktop:{naraTestScenario:async()=>{events.push('test');}}
 });
 assert.match((await runtime.runHumanALEVisualTest('thinking')).error,/suara/);
 assert.deepEqual(events,[]);
 runtime.naraSpeechBusy=()=>false;
 runtime.desktop.naraTestScenario=async()=>{throw new Error('real-test-failure');};
 runtime.scheduleNaraVoiceDrain=()=>events.push('resumed');
 await assert.rejects(runtime.runHumanALEVisualTest('thinking'),/real-test-failure/);
 assert.equal(runtime.naraVisualTestActive,false);
 assert.deepEqual(events,['resumed']);
});

test('detached panel runs controlled test through avatar narration owner and correlates the result',async()=>{
 let runs=0;
 const avatar=await visualTestRuntime({desktop:{naraTestScenario:async scenario=>{runs++;return {ok:true,restored:true,scenario};}}});
 const panel=await visualTestRuntime({panelOnly:true,desktop:{naraTestScenario:()=>assert.fail('panel bypassed avatar narration coordinator')}});
 avatar.panelChannel={postMessage:data=>panel.handleHumanALEVisualTestMessage(data)};
 panel.panelChannel={postMessage:data=>avatar.handleHumanALEVisualTestMessage(data)};
 const result=await panel.runHumanALEVisualTest('thinking');
 assert.equal(runs,1);
 assert.equal(result.scenario,'thinking');
 assert.equal(result.restored,true);
 assert.equal(panel.pendingVisualTests.size,0);
 assert.equal(avatar.naraVisualTestActive,false);
});

test('HumanALE Visual Studio normalizes bounded runtime telemetry without a renderer',()=>{
 const dom={querySelector:()=>null};
 const memory=new Map();
 const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
 const studio=createHumanALEVisualStudio({
  root:dom,
  storage,
  getSnapshot:()=>({
   runtime:{state:'thinking',rendererMode:'active',activity:2,controlledBy:'NARA_CORE',reason:'reason.start'},
   nara:{lifecycle:'active',selectedRegion:'REASONER',currentTask:'Audit',lastEvent:'reason.start'},
   sensors:{hearing:true,hearingEnergy:2,vision:false,speech:false},
   performance:{fps:61.2,points:1234,material:'matrix',zoom:2.4},
   health:{status:'ready',errorCount:0,errorRegions:[]},
   scene:{material:'matrix',accent:'violet',environment:'dark',track:false,animate:true,brainZoom:9},
   regions:[{id:'REASONER',status:'thinking',activity:2,message:'Analisis'}],
   connections:[{id:'GITHUB',status:'connected'}],
   timeline:Array.from({length:40},(_,i)=>({event:'event.'+i,timestamp:i,state:'thinking',region:'REASONER'})),
   skills:[{id:'reasoning',label:'Reasoning',group:'cognitive',region:'REASONER',state:'ready',regionStatus:'ready',activity:.4,message:'Ready',dependencies:['memory'],missingDependencies:[],permissions:['state:read'],dependencyOk:true,testScenario:'thinking'}],
   skillCounts:{total:1,ready:1,running:0,blocked:0,error:0,offline:0,setup:0}
  })
 });
 const snap=studio.syncPayload().snapshot;
 assert.equal(snap.runtime.controlledBy,'NARA_CORE');
 assert.equal(snap.runtime.activity,1);
 assert.equal(snap.sensors.hearingEnergy,1);
 assert.equal(snap.performance.fps,61);
 assert.equal(snap.performance.points,1234);
 assert.equal(snap.scene.brainZoom,3.8);
 assert.equal(snap.scene.track,false);
 assert.equal(snap.regions[0].activity,1);
 assert.equal(snap.connections[0].id,'GITHUB');
 assert.equal(snap.timeline.length,24);
 assert.equal(snap.timeline[0].event,'event.16');
 assert.equal(snap.skills[0].id,'reasoning');
 assert.equal(snap.skills[0].testScenario,'thinking');
 assert.equal(snap.skillCounts.ready,1);
 assert.equal(HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY,'humanale.visual-studio.snapshot.v1');
 assert.equal(HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY,'humanale.visual-studio.real-test-evidence.v1');
});

test('separate Visual Studio panel preserves 16 skills after controlled skill test',async()=>{
 const listeners={};
 const makeNode=()=>({
  dataset:{},style:{},children:[],textContent:'',className:'',type:'',value:'',checked:false,disabled:false,
  append(...nodes){this.children.push(...nodes);},
  replaceChildren(...nodes){this.children=[...nodes];},
  setAttribute(){},
  addEventListener(type,handler){listeners[type]=handler;}
 });
 const inspector=makeNode();
 const dom={
  querySelector:selector=>selector==='#visualStudioSkillInspector'?inspector:null,
  querySelectorAll:()=>[],
  createElement:()=>makeNode()
 };
 const skills=Array.from({length:16},(_,index)=>({
  id:'skill-'+String(index+1).padStart(2,'0'),
  label:'Skill '+(index+1),
  group:'capability',
  region:'NARA_CORE',
  state:'ready',
  regionStatus:'active',
  activity:.5,
  message:'Ready',
  dependencies:[],
  missingDependencies:[],
  permissions:['state:read'],
  dependencyOk:true,
  testScenario:index===0?'thinking':null
 }));
 const panelSnapshot={
  runtime:{state:'idle',rendererMode:'eco',activity:0,controlledBy:'NARA_CORE',reason:'test.ready'},
  nara:{lifecycle:'active',selectedRegion:'NARA_CORE',currentTask:'',lastEvent:'test.ready'},
  performance:{fps:60,points:1600,material:'mixed',zoom:1},
  health:{status:'ready',errorCount:0,errorRegions:[]},
  skills,
  skillCounts:{total:16,ready:16,running:0,blocked:0,error:0,offline:0,setup:0}
 };
 const studio=createHumanALEVisualStudio({
  root:dom,
  isPanel:true,
  getSnapshot:()=>({}),
  onTestScenario:async()=>({ok:true,restored:true,durationMs:4,trace:[]})
 });
 studio.handleMessage({type:'humanale-visual-studio-sync',snapshot:panelSnapshot});
 assert.equal(studio.current().skills.length,16);
 assert.equal(studio.syncPayload().snapshot.skills.length,16);
 assert.equal(studio.syncPayload().snapshot.skillCounts.total,16);
 const health=studio.runHealthScan();
 assert.equal(health.find(item=>item.name==='NARA lifecycle')?.status,'PASS');
 const button={
  dataset:{skillTest:'skill-01',scenario:'thinking'},
  closest:selector=>selector==='[data-skill-test]'?button:null
 };
 assert.equal(typeof listeners.click,'function');
 await listeners.click({target:button});
 assert.equal(studio.current().skills.length,16);
 assert.equal(studio.current().skillCounts.total,16);
 assert.equal(studio.syncPayload().snapshot.skills.length,16);
 assert.equal(studio.testHistory().at(-1)?.scenario,'skill:skill-01');
 assert.equal(studio.testHistory().at(-1)?.ok,true);
});

test('HumanALE Visual Studio UI and runtime wiring remain present',async()=>{
 const [html,app,desktop,style,module]=await Promise.all([
  readFile(new URL('public/index.html',root),'utf8'),
  readFile(new URL('public/app.js',root),'utf8'),
  readFile(new URL('desktop/main.cjs',root),'utf8'),
  readFile(new URL('public/style.css',root),'utf8'),
  readFile(new URL('public/humanale-visual-studio.js',root),'utf8')
 ]);
 assert.match(html,/id="humanaleVisualStudioOpen"/);
 assert.match(html,/id="humanaleVisualStudio"/);
 for(const id of ['visualStudioState','visualStudioRenderer','visualStudioActivity','visualStudioController','visualStudioHearing','visualStudioVision','visualStudioSpeech','visualStudioFps','visualStudioPoints','visualStudioHealth','visualStudioSceneMaterial','visualStudioSceneAccent','visualStudioSceneEnvironment','visualStudioSceneTrack','visualStudioSceneAnimate','visualStudioSceneZoom','visualStudioRegions','visualStudioConnections','visualStudioTimeline','visualStudioPerformanceHistory','visualStudioTestStatus','visualStudioTestTrace','visualStudioHealthScan','visualStudioHealthChecks','visualStudioTestHistory','visualStudioSkillTotal','visualStudioSkillReady','visualStudioSkillRunning','visualStudioSkillBlocked','visualStudioSkillError','visualStudioSkillSetup','visualStudioSkills','visualStudioSkillInspector','visualStudioRealTestStatus','visualStudioRealTestPreflight','visualStudioRealTestReset','visualStudioRealTestChecks']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(app,/createHumanALEVisualStudio/);
 assert.match(app,/humanaleVisualStudioSnapshot/);
 assert.match(app,/avatar\.onFrame=frame/);
 assert.match(app,/lastVisualStudioBroadcast<400/);
 assert.match(app,/panelChannel\?\.postMessage\(humanaleVisualStudio\.syncPayload\(\)\)/);
 assert.match(app,/applyHumanALEVisualScene/);
 assert.match(app,/selectHumanALEVisualRegion/);
 assert.match(app,/humanaleVisualEvents=.*slice\(-24\)/);
 assert.match(app,/runHumanALEVisualTest/);
 assert.match(app,/desktop\?\.naraTestScenario/);
 assert.match(app,/desktop\?\.naraSkillSnapshot/);
 assert.match(app,/latestNaraSkillSnapshot/);
 assert.match(app,/refreshNaraSkillSnapshot/);
 assert.match(desktop,/humanaleVisualStudio/);
 assert.match(desktop,/HumanALE Visual Studio tidak menerima telemetri runtime utama/);
 assert.match(desktop,/HumanALE Visual Studio v2 scene controls tidak diterapkan ke renderer utama/);
 assert.match(desktop,/HumanALE Visual Studio v2 region map tidak tersinkron ke NARA Core/);
 assert.match(desktop,/HumanALE Visual Studio v2 performance history tidak menerima sampel bounded/);
 assert.match(desktop,/HumanALE Visual Studio v3 controlled thinking test tidak selesai/);
 assert.match(desktop,/HumanALE Visual Studio v3 tidak mengembalikan NARA ke IDLE\/ECO/);
 assert.match(desktop,/HumanALE Visual Studio v3 Health Scan tidak menghasilkan pemeriksaan runtime/);
 assert.match(desktop,/HumanALE Visual Studio v3 menerima skenario test di luar whitelist/);
 assert.match(desktop,/HumanALE Visual Studio v4 NARA skill snapshot tidak valid/);
 assert.match(desktop,/HumanALE Visual Studio v4 Skill Lab tidak menerima 16 capability NARA/);
 assert.match(desktop,/HumanALE Visual Studio v4 inspector dependency\/permission Reasoning tidak siap/);
 assert.match(desktop,/HumanALE Visual Studio v4 controlled Reasoning skill test gagal/);
 assert.match(desktop,/HumanALE Visual Studio v4 skill test tidak mengembalikan NARA ke IDLE\/ECO/);
 assert.match(style,/\/\* HumanALE Visual Studio \*\//);
 assert.match(style,/\/\* HumanALE Visual Studio v2 \*\//);
 assert.match(style,/\/\* HumanALE Visual Studio v3 \*\//);
 assert.match(style,/\/\* HumanALE Visual Studio v4 \*\//);
 assert.match(style,/HumanALE Visual Studio v5/);
 assert.match(module,/performanceHistory=.*slice\(-30\)/);
 assert.match(module,/humanale-visual-studio-scene/);
 assert.match(module,/humanale-visual-studio-region/);
 assert.match(module,/data-nara-test|\[data-nara-test\]/);
 assert.match(module,/testHistory=.*slice\(-12\)/);
 assert.match(module,/runHealthScan/);
 assert.match(module,/selectedSkillId/);
 assert.match(module,/data-skill-test/);
 assert.match(module,/\[data-skill-id\]/);
 assert.match(module,/evaluateHumanALEVisualRealTestPreflight/);
 assert.match(module,/data-real-test-check/);
 assert.match(module,/READY_FOR_REAL_TEST|visualStudioRealTestStatus/);
 assert.match(html,/data-nara-test="thinking"/);
 assert.match(html,/data-nara-test="full"/);
 assert.match(html,/NARA SKILL & CAPABILITY LAB/);
 assert.doesNotMatch(module,/new HumanALEAvatar|new NeuralAvatar|createElement\(['"]canvas/);
});


test('HumanALE Visual Studio v5 exposes fail-closed real-test preflight UI',async()=>{
 const [html,module,realTest]=await Promise.all([
  readFile(new URL('public/index.html',root),'utf8'),
  readFile(new URL('public/humanale-visual-studio.js',root),'utf8'),
  readFile(new URL('public/humanale-visual-real-test.js',root),'utf8')
 ]);
 assert.match(html,/FINAL REAL-TEST PREFLIGHT/);
 assert.match(html,/visualStudioRealTestChecks/);
 assert.match(module,/HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY/);
 assert.match(module,/operator-local/);
 assert.match(realTest,/REAL_TEST_PASS/);
 assert.match(realTest,/realDevicePending/);
});
