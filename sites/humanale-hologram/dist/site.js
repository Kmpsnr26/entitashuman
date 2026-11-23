// Use the AleCore AI face engine in procedural-only mode. No PNG/JPG face map is loaded.
const canvas = document.querySelector('#avatar');
const avatar = new window.NeuralAvatar(canvas);
// The Site stage stays dark even when the visitor's OS theme is light.
avatar.setEnvironment('dark');
window.humanALEAvatar = avatar;

const state = document.querySelector('#state');
const showState = (label, delay = 1800) => {
  state.textContent = label;
  clearTimeout(showState.timer);
  if (delay) showState.timer = setTimeout(() => { state.textContent = 'SIAP'; }, delay);
};

let aleVoiceUnlocked=false,aleVoiceGeneration=0;
const speakAleCue=cue=>{
  if(!aleVoiceUnlocked||!cue?.text||!window.speechSynthesis)return;
  const utterance=new SpeechSynthesisUtterance(cue.text);
  utterance.lang='id-ID';
  utterance.rate=.94;
  utterance.pitch=.76;
  utterance.voice=window.speechSynthesis.getVoices().find(voice=>voice.lang.toLowerCase().startsWith('id'))||null;
  const generation=++aleVoiceGeneration;
  utterance.onstart=()=>{if(generation===aleVoiceGeneration){avatar.setSpeaking(true);runtime.dispatch('speech.start',{energy:.55,source:'alecore-ai-site'});}};
  utterance.onend=utterance.onerror=()=>{if(generation===aleVoiceGeneration){avatar.setSpeaking(false);runtime.dispatch('speech.stop',{source:'alecore-ai-site'});}};
  window.speechSynthesis.speak(utterance);
};
const runtime=window.HumanALEAleRuntime.create({
  regions:avatar.neuralCore.regions,
  onVoice:cue=>{showState(cue.text.toUpperCase(),2200);speakAleCue(cue);}
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
  const id=latestBrainState?.selectedRegion||'ALECORE_AI';
  const region=latestBrainState?.regions?.[id]||{};
  const meta=regionMeta[id]||{label:id.replaceAll('_',' ')};
  if(inspectName)inspectName.textContent=meta.label||id;
  if(inspectStatus)inspectStatus.textContent=String(region.status||'idle').toUpperCase();
  if(inspectActivity)inspectActivity.textContent=Math.round((Number(region.activity)||0)*100)+'%';
  if(inspectEvent)inspectEvent.textContent=String(region.lastEvent||'—');
  if(inspectUpdated)inspectUpdated.textContent=region.updatedAt?new Date(region.updatedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  if(inspectMessage)inspectMessage.textContent=String(region.message||'Region siap menerima aktivitas AleCore AI.');
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
  showState('AleCore AI · '+region.replaceAll('_',' '),0);
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

const memorySummary=document.querySelector('#memorySummary');
const memoryPersistence=document.querySelector('#memoryPersistence');
const memoryForm=document.querySelector('#memoryForm');
const memoryTitleInput=document.querySelector('#memoryTitleInput');
const memoryNote=document.querySelector('#memoryNote');
const memoryTags=document.querySelector('#memoryTags');
const memorySearch=document.querySelector('#memorySearch');
const memorySearchButton=document.querySelector('#memorySearchButton');
const memoryList=document.querySelector('#memoryList');
const memoryClear=document.querySelector('#memoryClear');
let currentMemoryResults=null;

const renderMemory=state=>{
  if(memorySummary)memorySummary.textContent=state.count+' / '+state.maxEntries+' memori lokal';
  if(memoryPersistence)memoryPersistence.textContent=state.persistent?'PERSISTEN LOKAL':'SESI SAJA';
  if(!memoryList)return;
  const entries=currentMemoryResults??state.entries.slice().reverse().slice(0,12);
  memoryList.replaceChildren();
  if(!entries.length){
    const empty=document.createElement('div');empty.className='memory-empty';
    empty.textContent=currentMemoryResults?'Tidak ada memori yang cocok.':'Belum ada memori proyek.';
    memoryList.append(empty);return;
  }
  for(const entry of entries){
    const item=document.createElement('article');item.className='memory-item';
    const top=document.createElement('div');top.className='memory-item-top';
    const title=document.createElement('strong');title.textContent=entry.title||'Memori AleCore AI';
    const type=document.createElement('span');type.textContent=entry.type;
    top.append(title,type);
    const summary=document.createElement('p');summary.textContent=entry.summary||'';
    const tags=document.createElement('div');tags.className='memory-tags';
    for(const tag of entry.tags||[]){const tagNode=document.createElement('span');tagNode.textContent=tag;tags.append(tagNode);}
    const actions=document.createElement('div');actions.className='memory-item-actions';
    const forget=document.createElement('button');forget.type='button';forget.textContent='Hapus';forget.dataset.memoryId=entry.id;
    actions.append(forget);item.append(top,summary,tags,actions);memoryList.append(item);
  }
};

const memory=window.HumanALEMemory.create({
  runtime,
  onState:state=>{if(!currentMemoryResults)renderMemory(state);},
  onError:error=>showState('MEMORY · '+String(error?.message||'GAGAL').toUpperCase(),2600)
});
window.humanALEMemory=memory;
renderMemory(memory.snapshot());

memoryForm?.addEventListener('submit',event=>{
  event.preventDefault();
  const title=memoryTitleInput?.value||'';
  const summary=memoryNote?.value||'';
  if(!title.trim()&&!summary.trim()){showState('MEMORY · CATATAN KOSONG');return;}
  const tags=String(memoryTags?.value||'').split(',').map(value=>value.trim()).filter(Boolean);
  const saved=memory.remember({type:'note',title,summary,tags,source:'manual'});
  if(saved){
    if(memoryTitleInput)memoryTitleInput.value='';
    if(memoryNote)memoryNote.value='';
    if(memoryTags)memoryTags.value='';
    if(memorySearch)memorySearch.value='';
    currentMemoryResults=null;
    renderMemory(memory.snapshot());
    avatar.setZoom?.(3.05);avatar.selectBrainRegion?.('MEMORY');
    showState('MEMORY · TERSIMPAN');
  }
});

const runMemorySearch=()=>{
  const query=memorySearch?.value||'';
  currentMemoryResults=memory.recall(query,{limit:12});
  renderMemory(memory.snapshot());
  avatar.setZoom?.(3.05);avatar.selectBrainRegion?.('MEMORY');
  showState(currentMemoryResults.length?'MEMORY · '+currentMemoryResults.length+' DITEMUKAN':'MEMORY · TIDAK DITEMUKAN');
};
memorySearchButton?.addEventListener('click',runMemorySearch);
memorySearch?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runMemorySearch();}});
memorySearch?.addEventListener('input',()=>{if(!memorySearch.value){currentMemoryResults=null;renderMemory(memory.snapshot());}});
memoryList?.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-memory-id]');
  if(!button)return;
  if(memory.forget(button.dataset.memoryId)){
    currentMemoryResults=null;renderMemory(memory.snapshot());showState('MEMORY · DIHAPUS');
  }
});
memoryClear?.addEventListener('click',()=>{
  if(!memory.snapshot().count)return;
  if(!window.confirm('Hapus seluruh memori lokal AleCore AI di browser ini?'))return;
  memory.clear();currentMemoryResults=null;renderMemory(memory.snapshot());showState('MEMORY · DIKOSONGKAN');
});

const contextStatus=document.querySelector('#contextStatus');
const contextBadge=document.querySelector('#contextBadge');
const contextMode=document.querySelector('#contextMode');
const contextTarget=document.querySelector('#contextTarget');
const contextTask=document.querySelector('#contextTask');
const contextPrepare=document.querySelector('#contextPrepare');
const contextCount=document.querySelector('#contextCount');
const contextChars=document.querySelector('#contextChars');
const contextApproval=document.querySelector('#contextApproval');
const contextPreview=document.querySelector('#contextPreview');
const contextApprove=document.querySelector('#contextApprove');
const contextUse=document.querySelector('#contextUse');
const contextReject=document.querySelector('#contextReject');
let approvedContextPacket=null;

const renderContext=state=>{
  const pending=state?.pending;
  if(contextMode&&contextMode.value!==state.mode)contextMode.value=state.mode;
  if(contextBadge)contextBadge.textContent=state.mode==='off'?'OFF':state.mode==='auto-safe'?'AUTO-SAFE':'TANYA DULU';
  if(contextStatus)contextStatus.textContent=!pending?'Belum ada context':pending.blocked?'Context diblokir':pending.approved?'Context disetujui':'Menunggu persetujuan';
  if(contextCount)contextCount.textContent=(pending?.count||0)+' entry';
  if(contextChars)contextChars.textContent=(pending?.chars||0)+' karakter';
  if(contextApproval)contextApproval.textContent=!pending?'belum siap':pending.blocked?'blocked':pending.approved?'approved':'pending';
  if(contextApprove)contextApprove.disabled=!pending||pending.blocked||pending.approved||!pending.requiresApproval;
  if(contextUse)contextUse.disabled=!pending||pending.blocked||!pending.approved;
  if(contextReject)contextReject.disabled=!pending;
};
const contextBridge=window.HumanALEContextBridge.create({runtime,memory,onState:renderContext});
window.humanALEContextBridge=contextBridge;
renderContext(contextBridge.snapshot());

contextMode?.addEventListener('change',()=>{
  approvedContextPacket=null;
  contextBridge.setMode(contextMode.value);
  if(contextPreview)contextPreview.textContent='Mode diubah. Pilih context kembali.';
});
contextPrepare?.addEventListener('click',()=>{
  approvedContextPacket=null;
  const preview=contextBridge.prepare(contextTask?.value||'',{target:contextTarget?.value||'reasoner'});
  if(contextPreview)contextPreview.textContent=preview?.text||'Tidak ada memori relevan untuk task ini.';
  renderContext(contextBridge.snapshot());
  if(preview?.count){avatar.setZoom?.(3.05);avatar.selectBrainRegion?.('MEMORY');}
});
contextApprove?.addEventListener('click',()=>{
  const pending=contextBridge.snapshot().pending;
  if(!pending||!contextBridge.approve(pending.id))return;
  renderContext(contextBridge.snapshot());
  showState('CONTEXT · DISETUJUI');
});
contextUse?.addEventListener('click',()=>{
  const pending=contextBridge.snapshot().pending;
  if(!pending)return;
  try{
    approvedContextPacket=contextBridge.transport(pending.id);
    window.humanALEApprovedContext=approvedContextPacket;
    renderContext(contextBridge.snapshot());
    const targetRegion=approvedContextPacket.target==='planner'?'PLANNER':approvedContextPacket.target==='agent'?'AGENT_MANAGER':'REASONER';
    avatar.setZoom?.(3.05);avatar.selectBrainRegion?.(targetRegion);
    showState('CONTEXT · PACKET SIAP');
  }catch(error){showState('CONTEXT · '+String(error?.message||'DITOLAK').toUpperCase(),2600);}
});
contextReject?.addEventListener('click',()=>{
  const pending=contextBridge.snapshot().pending;
  if(pending)contextBridge.reject(pending.id);else contextBridge.clearPending();
  approvedContextPacket=null;window.humanALEApprovedContext=null;
  if(contextPreview)contextPreview.textContent='Context dibersihkan.';
  renderContext(contextBridge.snapshot());
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
sensorStopButton?.addEventListener('click',async()=>{await sensors.stopAll();showState('SENSOR AleCore AI BERHENTI');});

const unlockAleVoice=()=>{aleVoiceUnlocked=true;};
window.addEventListener('pointerdown',unlockAleVoice,{once:true});
window.addEventListener('keydown',unlockAleVoice,{once:true});

showState('WAJAH PROCEDURAL SIAP');
dataSpine.start();
cognition.start();
memory.start();
runtime.start();
connections.start();

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
    (value < 1.5 ? 'wajah' : value < 2.15 ? 'rongga kepala' : value < 2.75 ? 'otak 3D' : value < 3.3 ? 'AleCore AI neural' : 'node / modul');
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
    speechGeneration++;aleVoiceGeneration++;
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
  aleVoiceUnlocked=false;
  sensors.stopAll().catch(()=>{});
  connections.stop();
  memory.stop();
  cognition.stop();
  runtime.stop();
  dataSpine.stop();
},{once:true});
