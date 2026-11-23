import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('canonical site exposes explicit opt-in AleCore AI sensor controls',async()=>{
  const [html,site,sensors]=await Promise.all([
    read('sites/humanale-hologram/dist/index.html'),
    read('sites/humanale-hologram/dist/site.js'),
    read('sites/humanale-hologram/dist/alecore-ai-sensors.js')
  ]);
  assert.match(html,/id="sensorMic"/);
  assert.match(html,/id="sensorCamera"/);
  assert.match(html,/id="sensorStop"/);
  assert.match(html,/id="cameraPreview"/);
  assert.match(html,/LOKAL · OPT-IN/);
  assert.match(html,/\.\/alecore-ai-sensors\.js/);
  assert.match(site,/sensorMicButton\?\.addEventListener\('click'/);
  assert.match(site,/sensorCameraButton\?\.addEventListener\('click'/);
  assert.match(site,/sensors\.startMicrophone\(\)/);
  assert.match(site,/sensors\.startCamera\(\)/);
  assert.doesNotMatch(site,/^\s*(?:await\s+)?sensors\.start(?:Microphone|Camera)\(\)/m);
  assert.match(sensors,/getUserMedia/);
});

test('sensor router microphone emits bounded audio telemetry only after explicit start and cleans tracks',async()=>{
  delete globalThis.HumanALESensors;
  await import('../sites/humanale-hologram/dist/alecore-ai-sensors.js?sensor-test='+Date.now());
  const dispatched=[];
  const runtime={dispatch:(event,payload={})=>{dispatched.push({event,payload});return{event,payload};}};
  let constraints=null,rafCallback=null,cancelled=null,trackStopped=false,sourceDisconnected=false,contextClosed=false;
  const stream={getTracks:()=>[{stop(){trackStopped=true;}}]};
  const mediaDevices={getUserMedia:async value=>{constraints=value;return stream;}};
  class FakeAudioContext{
    constructor(){this.state='running';}
    createMediaStreamSource(){return{connect(){},disconnect(){sourceDisconnected=true;}};}
    createAnalyser(){return{
      frequencyBinCount:16,fftSize:0,smoothingTimeConstant:0,
      getByteFrequencyData(data){for(let i=0;i<data.length;i++)data[i]=128;}
    };}
    async close(){contextClosed=true;}
  }
  const oldRaf=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame=callback=>{rafCallback=callback;return 77;};
  globalThis.cancelAnimationFrame=id=>{cancelled=id;};
  try{
    const router=globalThis.HumanALESensors.create({runtime,mediaDevices,AudioContextClass:FakeAudioContext});
    assert.equal(dispatched.length,0);
    assert.equal(router.microphoneActive,false);
    await router.startMicrophone();
    assert.equal(router.microphoneActive,true);
    assert.equal(constraints.video,false);
    assert.equal(constraints.audio.echoCancellation,true);
    assert.equal(dispatched.length,0);
    rafCallback(120);
    const audio=dispatched.find(item=>item.event==='audio.energy'&&item.payload.energy>0);
    assert.ok(audio);
    assert.ok(audio.payload.energy>0&&audio.payload.energy<=1);
    assert.ok(audio.payload.low>=0&&audio.payload.low<=1);
    await router.stopMicrophone();
    assert.equal(router.microphoneActive,false);
    assert.equal(trackStopped,true);
    assert.equal(sourceDisconnected,true);
    assert.equal(contextClosed,true);
    assert.equal(cancelled,77);
    assert.equal(dispatched.at(-1).event,'audio.energy');
    assert.equal(dispatched.at(-1).payload.energy,0);
  }finally{
    globalThis.requestAnimationFrame=oldRaf;
    globalThis.cancelAnimationFrame=oldCancel;
  }
});

test('sensor router camera computes local motion state, never uploads frames, and stops on request',async()=>{
  delete globalThis.HumanALESensors;
  await import('../sites/humanale-hologram/dist/alecore-ai-sensors.js?camera-test='+Date.now());
  const dispatched=[];
  const runtime={dispatch:(event,payload={})=>{dispatched.push({event,payload});return{event,payload};}};
  let constraints=null,trackStopped=false,intervalCallback=null,intervalCleared=null,paused=false;
  const stream={getTracks:()=>[{stop(){trackStopped=true;}}]};
  const mediaDevices={getUserMedia:async value=>{constraints=value;return stream;}};
  const video={videoWidth:640,hidden:true,srcObject:null,async play(){},pause(){paused=true;}};
  const pixels=new Uint8ClampedArray(64*48*4);
  pixels.fill(100);
  const oldDocument=globalThis.document,oldSetInterval=globalThis.setInterval,oldClearInterval=globalThis.clearInterval;
  globalThis.document={createElement:name=>{
    assert.equal(name,'canvas');
    return{width:0,height:0,getContext:()=>({
      drawImage(){},
      getImageData(){return{data:pixels};}
    })};
  }};
  globalThis.setInterval=callback=>{intervalCallback=callback;return 88;};
  globalThis.clearInterval=id=>{intervalCleared=id;};
  try{
    const router=globalThis.HumanALESensors.create({runtime,video,mediaDevices});
    assert.equal(dispatched.length,0);
    await router.startCamera();
    assert.equal(router.cameraActive,true);
    assert.equal(constraints.audio,false);
    assert.equal(constraints.video.facingMode,'user');
    assert.equal(video.hidden,false);
    assert.equal(video.srcObject,stream);
    assert.ok(dispatched.some(item=>item.event==='vision.frame'));
    assert.equal(typeof intervalCallback,'function');
    pixels.fill(145);
    intervalCallback();
    const frames=dispatched.filter(item=>item.event==='vision.frame');
    assert.ok(frames.length>=2);
    assert.ok(frames.at(-1).payload.activity>0);
    router.stopCamera();
    assert.equal(router.cameraActive,false);
    assert.equal(trackStopped,true);
    assert.equal(paused,true);
    assert.equal(intervalCleared,88);
    assert.equal(video.hidden,true);
    assert.equal(video.srcObject,null);
    assert.equal(dispatched.at(-1).event,'vision.stop');
  }finally{
    globalThis.document=oldDocument;
    globalThis.setInterval=oldSetInterval;
    globalThis.clearInterval=oldClearInterval;
  }
  const sensors=await read('sites/humanale-hologram/dist/alecore-ai-sensors.js');
  assert.doesNotMatch(sensors,/fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon|FormData/);
});

test('avatar visualizes hearing vision and speech from BrainState without changing face geometry',async()=>{
  const [avatar,rig]=await Promise.all([
    read('sites/humanale-hologram/dist/avatar.js'),
    read('sites/humanale-hologram/dist/face-rig.js')
  ]);
  assert.match(avatar,/this\.sensoryState=/);
  assert.match(avatar,/drawSensorSignals\(c,time\)/);
  assert.match(avatar,/brainStatusColor\('listening'/);
  assert.match(avatar,/brainStatusColor\('seeing'/);
  assert.match(avatar,/brainStatusColor\('speaking'/);
  assert.match(avatar,/snapshot\?\.sensory\?\.hearing/);
  assert.match(avatar,/snapshot\?\.sensory\?\.vision/);
  assert.match(avatar,/snapshot\?\.sensory\?\.speech/);
  assert.match(rig,/mouthWeights/);
});

test('privacy lifecycle stops browser sensors when page is hidden or closed',async()=>{
  const site=await read('sites/humanale-hologram/dist/site.js');
  assert.match(site,/visibilitychange/);
  assert.match(site,/sensors\.stopAll\(\)\.catch/);
  assert.match(site,/pagehide/);
  assert.match(site,/runtime\.stop\(\)/);
});
