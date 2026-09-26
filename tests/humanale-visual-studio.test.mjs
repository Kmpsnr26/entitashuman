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
   health:{status:'ready',errorCount:0,errorRegions:[]}
  })
 });
 const snap=studio.syncPayload().snapshot;
 assert.equal(snap.runtime.controlledBy,'NARA_CORE');
 assert.equal(snap.runtime.activity,1);
 assert.equal(snap.sensors.hearingEnergy,1);
 assert.equal(snap.performance.fps,61);
 assert.equal(snap.performance.points,1234);
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
 for(const id of ['visualStudioState','visualStudioRenderer','visualStudioActivity','visualStudioController','visualStudioHearing','visualStudioVision','visualStudioSpeech','visualStudioFps','visualStudioPoints','visualStudioHealth']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(app,/createHumanALEVisualStudio/);
 assert.match(app,/humanaleVisualStudioSnapshot/);
 assert.match(app,/avatar\.onFrame=frame/);
 assert.match(app,/lastVisualStudioBroadcast<400/);
 assert.match(app,/panelChannel\?\.postMessage\(humanaleVisualStudio\.syncPayload\(\)\)/);
 assert.match(desktop,/humanaleVisualStudio/);
 assert.match(desktop,/HumanALE Visual Studio tidak menerima telemetri runtime utama/);
 assert.match(style,/\/\* HumanALE Visual Studio \*\//);
 assert.doesNotMatch(module,/new HumanALEAvatar|new NeuralAvatar|createElement\(['"]canvas/);
});
