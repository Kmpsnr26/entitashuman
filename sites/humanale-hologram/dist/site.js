// Reuse the exact NARA face engine and reference image from the local avatar.
const canvas = document.querySelector('#avatar');
const avatar = new window.NeuralAvatar(canvas, {
  referenceSrc: new URL('./assets/reference-face.png', import.meta.url).href
});
// The Site stage stays dark even when the visitor's OS theme is light.
avatar.setEnvironment('dark');
window.humanALEAvatar = avatar;

const state = document.querySelector('#state');
const showState = (label, delay = 1800) => {
  state.textContent = label;
  clearTimeout(showState.timer);
  if (delay) showState.timer = setTimeout(() => { state.textContent = 'SIAP'; }, delay);
};

let naraVoiceUnlocked=false,naraVoiceGeneration=0;
const speakNaraCue=cue=>{
  if(!naraVoiceUnlocked||!cue?.text||!window.speechSynthesis)return;
  const utterance=new SpeechSynthesisUtterance(cue.text);
  utterance.lang='id-ID';
  utterance.rate=.94;
  utterance.pitch=.76;
  utterance.voice=window.speechSynthesis.getVoices().find(voice=>voice.lang.toLowerCase().startsWith('id'))||null;
  const generation=++naraVoiceGeneration;
  utterance.onstart=()=>{if(generation===naraVoiceGeneration){avatar.setSpeaking(true);runtime.dispatch('speech.start',{energy:.55,source:'nara-site'});}};
  utterance.onend=utterance.onerror=()=>{if(generation===naraVoiceGeneration){avatar.setSpeaking(false);runtime.dispatch('speech.stop',{source:'nara-site'});}};
  window.speechSynthesis.speak(utterance);
};
const runtime=window.HumanALENaraRuntime.create({
  regions:avatar.neuralCore.regions,
  onVoice:cue=>{showState(cue.text.toUpperCase(),2200);speakNaraCue(cue);}
});
window.humanALENara=runtime;

const regionMeta=Object.fromEntries((avatar.neuralCore.regions||[]).map(region=>[region.id,region]));
const inspectName=document.querySelector('#inspectName');
const inspectStatus=document.querySelector('#inspectStatus');
const inspectActivity=document.querySelector('#inspectActivity');
const inspectEvent=document.querySelector('#inspectEvent');
const inspectUpdated=document.querySelector('#inspectUpdated');
const inspectMessage=document.querySelector('#inspectMessage');
const connectionSummary=document.querySelector('#connectionSummary');
const connectionButtons=[...document.querySelectorAll('#connectionGrid [data-region]')];
let latestBrainState=runtime.snapshot();

const updateInspector=(snapshot=latestBrainState)=>{
  latestBrainState=snapshot||latestBrainState;
  const id=latestBrainState?.selectedRegion||'NARA_CORE';
  const region=latestBrainState?.regions?.[id]||{};
  const meta=regionMeta[id]||{label:id.replaceAll('_',' ')};
  if(inspectName)inspectName.textContent=meta.label||id;
  if(inspectStatus)inspectStatus.textContent=String(region.status||'idle').toUpperCase();
  if(inspectActivity)inspectActivity.textContent=Math.round((Number(region.activity)||0)*100)+'%';
  if(inspectEvent)inspectEvent.textContent=String(region.lastEvent||'—');
  if(inspectUpdated)inspectUpdated.textContent=region.updatedAt?new Date(region.updatedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  if(inspectMessage)inspectMessage.textContent=String(region.message||'Region siap menerima aktivitas NARA.');
  for(const button of connectionButtons){
    const item=latestBrainState?.regions?.[button.dataset.region]||{};
    const status=String(item.status||'idle');
    button.dataset.status=status;
    const statusNode=button.querySelector('span');
    if(statusNode)statusNode.textContent=status;
  }
};

runtime.state.subscribe(snapshot=>{
  avatar.setBrainState?.(snapshot);
  updateInspector(snapshot);
});

avatar.onBrainRegionSelect=region=>{
  runtime.dispatch('brain.region.select',{region});
  showState('NARA · '+region.replaceAll('_',' '),0);
};
for(const button of connectionButtons)button.addEventListener('click',()=>{
  const region=button.dataset.region;
  avatar.setZoom?.(3.05);
  avatar.selectBrainRegion?.(region);
});

const dataSpine=window.HumanALEDataSpine.create({
  runtime,
  onState:spine=>avatar.setDataSpineState?.(spine)
});
window.humanALEDataSpine=dataSpine;

const cognitionStage=document.querySelector('#cognitionStage');
const cognitionTask=document.querySelector('#cognitionTask');
const cognitionTimeline=document.querySelector('#cognitionTimeline');
const cognitionButtons=[...document.querySelectorAll('[data-cognition-region]')];
const renderCognition=state=>{
  if(cognitionStage)cognitionStage.textContent=String(state?.activeStage||'IDLE');
  if(cognitionTask)cognitionTask.textContent=state?.currentTask?.label||'Tidak ada task aktif';
  const brain=runtime.snapshot();
  for(const button of cognitionButtons){
    const item=brain?.regions?.[button.dataset.cognitionRegion]||{};
    const status=String(item.status||'idle');
    button.dataset.status=status;
    const node=button.querySelector('span');if(node)node.textContent=status;
  }
  if(cognitionTimeline){
    cognitionTimeline.replaceChildren();
    for(const entry of (state?.entries||[]).slice(-8).reverse()){
      const li=document.createElement('li');
      const stage=document.createElement('b');stage.textContent=entry.stage;
      const label=document.createElement('span');label.textContent=entry.label;
      const status=document.createElement('em');status.textContent=entry.state;
      li.append(stage,label,status);cognitionTimeline.append(li);
    }
  }
};
const cognition=window.HumanALECognition.create({runtime,onState:renderCognition});
window.humanALECognition=cognition;
for(const button of cognitionButtons)button.addEventListener('click',()=>{
  avatar.setZoom?.(3.05);
  avatar.selectBrainRegion?.(button.dataset.cognitionRegion);
});

const connections=window.HumanALEConnections.create({
  runtime,
  onStatus:event=>{
    if(event?.type==='state'&&connectionSummary){
      const state=event.state;
      connectionSummary.textContent=state.online
        ? (state.authStatus==='connected'?'Web aktif · login aktif':'Web aktif · login diperlukan')
        : 'Web offline';
    }
  }
});
window.humanALEConnections=connections;
updateInspector(latestBrainState);

const sensorStatus=document.querySelector('#sensorStatus');
const sensorMicButton=document.querySelector('#sensorMic');
const sensorCameraButton=document.querySelector('#sensorCamera');
const sensorStopButton=document.querySelector('#sensorStop');
const updateSensorControls=({microphone=false,camera=false,message='' }={})=>{
  sensorMicButton?.setAttribute('aria-pressed',String(Boolean(microphone)));
  sensorCameraButton?.setAttribute('aria-pressed',String(Boolean(camera)));
  if(sensorStopButton)sensorStopButton.disabled=!microphone&&!camera;
  if(sensorStatus)sensorStatus.textContent=message||(microphone&&camera?'Mikrofon + kamera aktif':microphone?'Mikrofon aktif':camera?'Kamera aktif':'Tidak aktif');
};
const sensors=window.HumanALESensors.create({
  runtime,
  video:document.querySelector('#cameraPreview'),
  onStatus:status=>updateSensorControls({...status,message:status.message})
});
window.humanALESensors=sensors;
sensorMicButton?.addEventListener('click',async()=>{
  try{
    if(sensors.microphoneActive)await sensors.stopMicrophone();else await sensors.startMicrophone();
  }catch(error){showState('MIKROFON · '+String(error?.message||'GAGAL').toUpperCase(),2600);}
});
sensorCameraButton?.addEventListener('click',async()=>{
  try{
    if(sensors.cameraActive)sensors.stopCamera();else await sensors.startCamera();
  }catch(error){showState('KAMERA · '+String(error?.message||'GAGAL').toUpperCase(),2600);}
});
sensorStopButton?.addEventListener('click',async()=>{await sensors.stopAll();showState('SENSOR NARA BERHENTI');});

const unlockNaraVoice=()=>{naraVoiceUnlocked=true;};
window.addEventListener('pointerdown',unlockNaraVoice,{once:true});
window.addEventListener('keydown',unlockNaraVoice,{once:true});

avatar.referencePromise.then(loaded => {
  showState(loaded ? 'WAJAH NARA SIAP' : 'PETA WAJAH GAGAL DIMUAT');
  dataSpine.start();
  cognition.start();
  runtime.start();
  connections.start();
});

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  avatar.setMaterial(button.dataset.mode);
  document.querySelectorAll('[data-mode]').forEach(item => {
    const active = item === button;
    item.classList.toggle('selected', active);
    item.setAttribute('aria-pressed', String(active));
  });
  showState(button.textContent.toUpperCase());
}));

document.querySelector('#color').addEventListener('change', event => avatar.setAccent(event.target.value));
document.querySelector('#emotion').addEventListener('change', event => {
  avatar.setEmotion(event.target.value);
  showState(event.target.selectedOptions[0].textContent.toUpperCase());
});

const zoom = document.querySelector('#zoom');
avatar.onZoom = value => {
  zoom.value = String(value);
  document.querySelector('#zoom-value').textContent = value.toFixed(1) + '× · ' +
    (value < 1.5 ? 'wajah' : value < 2.15 ? 'rongga kepala' : value < 2.75 ? 'otak 3D' : value < 3.3 ? 'NARA neural' : 'node / modul');
};
zoom.addEventListener('input', event => avatar.setZoom(event.target.value));

let gestureTimer;
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  clearTimeout(gestureTimer);
  avatar.gestureYaw = avatar.gesturePitch = 0;
  if (action === 'blink') avatar.blinkStart = performance.now();
  if (action === 'nod') avatar.gesturePitch = 0.17;
  if (action === 'shake') avatar.gestureYaw = 0.22;
  if (action !== 'blink') gestureTimer = setTimeout(() => {
    avatar.gestureYaw = avatar.gesturePitch = 0;
  }, 420);
  showState(button.textContent.toUpperCase());
}));
canvas.addEventListener('click', event => {
  const region=avatar.pickBrainRegion?.(event.clientX,event.clientY);
  if(region){avatar.selectBrainRegion?.(region);return;}
  avatar.blinkStart = performance.now();
});

let speechGeneration = 0;
const stopSpeaking = (generation, label = 'SIAP') => {
  if (generation !== speechGeneration) return;
  avatar.setSpeaking(false);
  showState(label);
};
document.querySelector('#speech').addEventListener('submit', event => {
  event.preventDefault();
  const words = document.querySelector('#words').value.trim();
  if (!words) return;
  if (!window.speechSynthesis) { showState('SUARA TIDAK TERSEDIA'); return; }
  const generation = ++speechGeneration;
  window.speechSynthesis.cancel();
  avatar.setSpeaking(false);
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.lang = 'id-ID';
  utterance.rate = 0.95;
  utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('id')) || null;
  utterance.onstart = () => {
    if (generation !== speechGeneration) return;
    avatar.setSpeaking(true);
    runtime.dispatch('speech.start',{energy:.55,source:'site-manual'});
    showState('BERBICARA', 0);
  };
  utterance.onend = () => {runtime.dispatch('speech.stop',{source:'site-manual'});stopSpeaking(generation);};
  utterance.onerror = () => {runtime.dispatch('speech.stop',{source:'site-manual'});stopSpeaking(generation, 'SUARA GAGAL DIPUTAR');};
  window.speechSynthesis.speak(utterance);
});
document.addEventListener('visibilitychange', () => {
  if(document.hidden){
    speechGeneration++;naraVoiceGeneration++;
    window.speechSynthesis?.cancel();
    avatar.setSpeaking(false);
    runtime.dispatch('speech.stop',{source:'site-hidden'});
    sensors.stopAll().catch(()=>{});
    connections.stop();
  }else{
    connections.start();
  }
});
window.addEventListener('pagehide',()=>{
  naraVoiceUnlocked=false;
  sensors.stopAll().catch(()=>{});
  connections.stop();
  cognition.stop();
  runtime.stop();
  dataSpine.stop();
},{once:true});
