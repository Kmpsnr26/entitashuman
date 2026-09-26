export const HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY='humanale.visual-studio.snapshot.v1';

const text=value=>value===null||value===undefined||value===''?'—':String(value);
const percent=value=>Math.round(Math.max(0,Math.min(1,Number(value)||0))*100)+'%';

function safeSnapshot(value={}){
 const policy=value?.runtime||{};
 const sensory=value?.sensors||{};
 const performance=value?.performance||{};
 const nara=value?.nara||{};
 const health=value?.health||{};
 return {
  timestamp:Number(value?.timestamp)||Date.now(),
  runtime:{
   state:text(policy.state||'idle'),
   rendererMode:text(policy.rendererMode||'eco'),
   activity:Math.max(0,Math.min(1,Number(policy.activity)||0)),
   controlledBy:text(policy.controlledBy||'NARA_CORE'),
   reason:text(policy.reason||'nara.idle')
  },
  nara:{
   lifecycle:text(nara.lifecycle||'idle'),
   selectedRegion:text(nara.selectedRegion||'NARA_CORE'),
   currentTask:text(nara.currentTask||''),
   lastEvent:text(nara.lastEvent||'')
  },
  sensors:{
   hearing:Boolean(sensory.hearing),
   hearingEnergy:Math.max(0,Math.min(1,Number(sensory.hearingEnergy)||0)),
   vision:Boolean(sensory.vision),
   visionActivity:Math.max(0,Math.min(1,Number(sensory.visionActivity)||0)),
   speech:Boolean(sensory.speech),
   speechEnergy:Math.max(0,Math.min(1,Number(sensory.speechEnergy)||0))
  },
  performance:{
   fps:Math.max(0,Math.round(Number(performance.fps)||0)),
   points:Math.max(0,Math.round(Number(performance.points)||0)),
   material:text(performance.material||'mixed'),
   zoom:Number.isFinite(Number(performance.zoom))?Number(performance.zoom):1,
   renderTarget:text(performance.renderTarget||policy.rendererMode||'eco')
  },
  health:{
   status:text(health.status||'ready'),
   errorCount:Math.max(0,Math.round(Number(health.errorCount)||0)),
   errorRegions:Array.isArray(health.errorRegions)?health.errorRegions.map(item=>String(item).slice(0,40)).slice(0,12):[]
  }
 };
}

function setText(root,id,value){
 const el=root.querySelector?.('#'+id);
 if(el)el.textContent=text(value);
}

export function createHumanALEVisualStudio({
 root=document,
 storage=globalThis.localStorage,
 channel=null,
 isPanel=false,
 getSnapshot=()=>({}),
 onOpen=()=>{},
 onOpenAvatarStudio=()=>{},
 onToast=()=>{}
}={}){
 let current=safeSnapshot(getSnapshot?.());

 const render=value=>{
  current=safeSnapshot(value);
  setText(root,'visualStudioState',current.runtime.state.toUpperCase());
  setText(root,'visualStudioRenderer',current.runtime.rendererMode.toUpperCase());
  setText(root,'visualStudioActivity',percent(current.runtime.activity));
  setText(root,'visualStudioController',current.runtime.controlledBy);
  setText(root,'visualStudioReason',current.runtime.reason);
  setText(root,'visualStudioLifecycle',current.nara.lifecycle.toUpperCase());
  setText(root,'visualStudioRegion',current.nara.selectedRegion);
  setText(root,'visualStudioTask',current.nara.currentTask);
  setText(root,'visualStudioEvent',current.nara.lastEvent);
  setText(root,'visualStudioHearing',current.sensors.hearing?'ON · '+percent(current.sensors.hearingEnergy):'OFF');
  setText(root,'visualStudioVision',current.sensors.vision?'ON · '+percent(current.sensors.visionActivity):'OFF');
  setText(root,'visualStudioSpeech',current.sensors.speech?'ON · '+percent(current.sensors.speechEnergy):'OFF');
  setText(root,'visualStudioFps',current.performance.fps+' FPS');
  setText(root,'visualStudioPoints',current.performance.points.toLocaleString('id-ID'));
  setText(root,'visualStudioMaterial',current.performance.material.toUpperCase());
  setText(root,'visualStudioZoom',current.performance.zoom.toFixed(1)+'×');
  setText(root,'visualStudioHealth',current.health.errorCount?current.health.errorCount+' ERROR/BUG':'READY');
  setText(root,'visualStudioErrors',current.health.errorRegions.length?current.health.errorRegions.join(' · '):'Tidak ada region error aktif.');
  const stamp=root.querySelector?.('#visualStudioTimestamp');
  if(stamp)stamp.textContent=new Date(current.timestamp).toLocaleTimeString('id-ID');
  const dialog=root.querySelector?.('#humanaleVisualStudio');
  if(dialog){
   dialog.dataset.runtimeState=current.runtime.state;
   dialog.dataset.rendererMode=current.runtime.rendererMode;
   dialog.dataset.health=current.health.errorCount?'error':'ready';
  }
  return current;
 };

 const syncPayload=()=>({type:'humanale-visual-studio-sync',snapshot:safeSnapshot(getSnapshot?.()||current)});

 root.querySelector?.('#humanaleVisualStudioOpen')?.addEventListener('click',()=>onOpen());
 root.querySelector?.('#visualStudioRefresh')?.addEventListener('click',()=>{
  if(isPanel&&channel?.postMessage)channel.postMessage({type:'humanale-visual-studio-request'});
  else render(getSnapshot?.());
 });
 root.querySelector?.('#visualStudioAvatarStudio')?.addEventListener('click',()=>{
  if(isPanel&&channel?.postMessage)channel.postMessage({type:'humanale-visual-studio-open-avatar'});
  else onOpenAvatarStudio();
 });
 root.querySelector?.('#visualStudioSnapshot')?.addEventListener('click',()=>{
  const next=safeSnapshot(isPanel?current:getSnapshot?.());
  try{storage?.setItem?.(HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY,JSON.stringify(next));onToast('HumanALE Visual Studio · snapshot diagnostik tersimpan lokal.');}
  catch{onToast('HumanALE Visual Studio · snapshot lokal gagal disimpan.');}
 });

 return Object.freeze({
  render,
  current:()=>safeSnapshot(current),
  syncPayload,
  handleMessage(data={}){
   if(data.type==='humanale-visual-studio-sync'){render(data.snapshot);return true;}
   if(data.type==='humanale-visual-studio-request'&&!isPanel){channel?.postMessage?.(syncPayload());return true;}
   if(data.type==='humanale-visual-studio-open-avatar'&&!isPanel){onOpenAvatarStudio();return true;}
   return false;
  }
 });
}
