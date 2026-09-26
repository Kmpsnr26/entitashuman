import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHumanALEVisualStudio,HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY} from '../public/humanale-visual-studio.js';

const root=new URL('../',import.meta.url);

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
   timeline:Array.from({length:40},(_,i)=>({event:'event.'+i,timestamp:i,state:'thinking',region:'REASONER'}))
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
 assert.equal(HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY,'humanale.visual-studio.snapshot.v1');
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
 for(const id of ['visualStudioState','visualStudioRenderer','visualStudioActivity','visualStudioController','visualStudioHearing','visualStudioVision','visualStudioSpeech','visualStudioFps','visualStudioPoints','visualStudioHealth','visualStudioSceneMaterial','visualStudioSceneAccent','visualStudioSceneEnvironment','visualStudioSceneTrack','visualStudioSceneAnimate','visualStudioSceneZoom','visualStudioRegions','visualStudioConnections','visualStudioTimeline','visualStudioPerformanceHistory','visualStudioTestStatus','visualStudioTestTrace','visualStudioHealthScan','visualStudioHealthChecks','visualStudioTestHistory']){
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
 assert.match(desktop,/humanaleVisualStudio/);
 assert.match(desktop,/HumanALE Visual Studio tidak menerima telemetri runtime utama/);
 assert.match(desktop,/HumanALE Visual Studio v2 scene controls tidak diterapkan ke renderer utama/);
 assert.match(desktop,/HumanALE Visual Studio v2 region map tidak tersinkron ke NARA Core/);
 assert.match(desktop,/HumanALE Visual Studio v2 performance history tidak menerima sampel bounded/);
 assert.match(desktop,/HumanALE Visual Studio v3 controlled thinking test tidak selesai/);
 assert.match(desktop,/HumanALE Visual Studio v3 tidak mengembalikan NARA ke IDLE\/ECO/);
 assert.match(desktop,/HumanALE Visual Studio v3 Health Scan tidak menghasilkan pemeriksaan runtime/);
 assert.match(desktop,/HumanALE Visual Studio v3 menerima skenario test di luar whitelist/);
 assert.match(style,/\/\* HumanALE Visual Studio \*\//);
 assert.match(style,/\/\* HumanALE Visual Studio v2 \*\//);
 assert.match(style,/\/\* HumanALE Visual Studio v3 \*\//);
 assert.match(module,/performanceHistory=.*slice\(-30\)/);
 assert.match(module,/humanale-visual-studio-scene/);
 assert.match(module,/humanale-visual-studio-region/);
 assert.match(module,/data-nara-test|\[data-nara-test\]/);
 assert.match(module,/testHistory=.*slice\(-12\)/);
 assert.match(module,/runHealthScan/);
 assert.match(html,/data-nara-test="thinking"/);
 assert.match(html,/data-nara-test="full"/);
 assert.doesNotMatch(module,/new HumanALEAvatar|new NeuralAvatar|createElement\(['"]canvas/);
});
