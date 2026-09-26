export const HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY='humanale.visual-studio.snapshot.v1';

const text=value=>value===null||value===undefined||value===''?'—':String(value);
const percent=value=>Math.round(Math.max(0,Math.min(1,Number(value)||0))*100)+'%';

function safeSnapshot(value={}){
 const policy=value?.runtime||{};
 const sensory=value?.sensors||{};
 const performance=value?.performance||{};
 const nara=value?.nara||{};
 const health=value?.health||{};
 const scene=value?.scene||{};
 const regions=Array.isArray(value?.regions)?value.regions:[];
 const connections=Array.isArray(value?.connections)?value.connections:[];
 const timeline=Array.isArray(value?.timeline)?value.timeline:[];
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
  },
  scene:{
   material:text(scene.material||performance.material||'mixed'),
   accent:text(scene.accent||'cyan'),
   environment:text(scene.environment||'auto'),
   track:scene.track!==false,
   animate:scene.animate!==false,
   brainZoom:Number.isFinite(Number(scene.brainZoom))?Math.max(1,Math.min(3.8,Number(scene.brainZoom))):1
  },
  regions:regions.slice(0,32).map(region=>({
   id:text(region?.id).slice(0,40),
   status:text(region?.status||'idle').slice(0,30),
   activity:Math.max(0,Math.min(1,Number(region?.activity)||0)),
   message:text(region?.message||'').slice(0,120)
  })),
  connections:connections.slice(0,20).map(item=>({
   id:text(item?.id).slice(0,40),
   status:text(item?.status||'idle').slice(0,30)
  })),
  timeline:timeline.slice(-24).map(item=>({
   event:text(item?.event).slice(0,80),
   timestamp:Number(item?.timestamp)||0,
   state:text(item?.state||'').slice(0,30),
   region:text(item?.region||'').slice(0,40)
  }))
 };
}

function setText(root,id,value){
 const el=root.querySelector?.('#'+id);
 if(el)el.textContent=text(value);
}

function renderList(root,id,items,className,make){
 const host=root.querySelector?.('#'+id);
 if(!host)return;
 host.replaceChildren();
 for(const item of items){
  const node=root.createElement?.('button')||document.createElement('button');
  node.type='button';
  node.className=className;
  const view=make(item,node)||{};
  if(view.text!==undefined)node.textContent=String(view.text);
  for(const [key,value] of Object.entries(view.dataset||{}))node.dataset[key]=String(value);
  if(view.title)node.title=String(view.title);
  host.append(node);
 }
}

function syncControl(root,id,value){
 const el=root.querySelector?.('#'+id);
 if(!el)return;
 if(el.type==='checkbox')el.checked=Boolean(value);
 else if(String(el.value)!==String(value))el.value=String(value);
}

export function createHumanALEVisualStudio({
 root=document,
 storage=globalThis.localStorage,
 channel=null,
 isPanel=false,
 getSnapshot=()=>({}),
 onOpen=()=>{},
 onOpenAvatarStudio=()=>{},
 onSceneChange=()=>{},
 onRegionSelect=()=>{},
 onToast=()=>{}
}={}){
 let current=safeSnapshot(getSnapshot?.());
 let performanceHistory=[];
 let lastHistoryAt=0;

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
  syncControl(root,'visualStudioSceneMaterial',current.scene.material);
  syncControl(root,'visualStudioSceneAccent',current.scene.accent);
  syncControl(root,'visualStudioSceneEnvironment',current.scene.environment);
  syncControl(root,'visualStudioSceneTrack',current.scene.track);
  syncControl(root,'visualStudioSceneAnimate',current.scene.animate);
  syncControl(root,'visualStudioSceneZoom',current.scene.brainZoom);
  setText(root,'visualStudioSceneZoomValue',current.scene.brainZoom.toFixed(1)+'×');

  renderList(root,'visualStudioRegions',current.regions,'visual-studio-region',region=>({
   text:region.id+' · '+region.status.toUpperCase()+' · '+Math.round(region.activity*100)+'%',
   dataset:{region:region.id,status:region.status},
   title:region.message
  }));
  renderList(root,'visualStudioConnections',current.connections,'visual-studio-connection',item=>({
   text:item.id+' · '+item.status.toUpperCase(),
   dataset:{status:item.status}
  }));

  const timelineHost=root.querySelector?.('#visualStudioTimeline');
  if(timelineHost){
   timelineHost.replaceChildren();
   for(const item of [...current.timeline].reverse()){
    const row=root.createElement?.('div')||document.createElement('div');
    row.className='visual-studio-event';
    const when=item.timestamp?new Date(item.timestamp).toLocaleTimeString('id-ID'):'—';
    row.textContent=when+' · '+item.event+(item.region?' · '+item.region:'')+(item.state?' · '+item.state:'');
    timelineHost.append(row);
   }
  }

  if(current.timestamp-lastHistoryAt>=900){
   lastHistoryAt=current.timestamp;
   performanceHistory=[...performanceHistory,{fps:current.performance.fps,activity:current.runtime.activity,mode:current.runtime.rendererMode}].slice(-30);
  }
  const historyHost=root.querySelector?.('#visualStudioPerformanceHistory');
  if(historyHost){
   historyHost.replaceChildren();
   const maxFps=Math.max(60,...performanceHistory.map(item=>item.fps||0));
   for(const item of performanceHistory){
    const bar=root.createElement?.('i')||document.createElement('i');
    bar.style.height=Math.max(4,Math.round((item.fps/maxFps)*100))+'%';
    bar.dataset.mode=item.mode;
    bar.title=item.fps+' FPS · activity '+Math.round(item.activity*100)+'%';
    historyHost.append(bar);
   }
  }
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

 const sceneControls={
  visualStudioSceneMaterial:'material',
  visualStudioSceneAccent:'accent',
  visualStudioSceneEnvironment:'environment',
  visualStudioSceneTrack:'track',
  visualStudioSceneAnimate:'animate',
  visualStudioSceneZoom:'brainZoom'
 };
 for(const [id,name] of Object.entries(sceneControls)){
  root.querySelector?.('#'+id)?.addEventListener('input',event=>{
   const element=event.currentTarget||event.target;
   const value=element?.type==='checkbox'?Boolean(element.checked):name==='brainZoom'?Number(element.value):element.value;
   if(name==='brainZoom')setText(root,'visualStudioSceneZoomValue',Number(value).toFixed(1)+'×');
   if(isPanel&&channel?.postMessage)channel.postMessage({type:'humanale-visual-studio-scene',name,value});
   else onSceneChange(name,value);
  });
 }
 root.querySelector?.('#visualStudioRegions')?.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-region]');
  const region=button?.dataset?.region;
  if(!region)return;
  if(isPanel&&channel?.postMessage)channel.postMessage({type:'humanale-visual-studio-region',region});
  else onRegionSelect(region);
 });

 return Object.freeze({
  render,
  current:()=>safeSnapshot(current),
  syncPayload,
  handleMessage(data={}){
   if(data.type==='humanale-visual-studio-sync'){render(data.snapshot);return true;}
   if(data.type==='humanale-visual-studio-request'&&!isPanel){channel?.postMessage?.(syncPayload());return true;}
   if(data.type==='humanale-visual-studio-open-avatar'&&!isPanel){onOpenAvatarStudio();return true;}
   if(data.type==='humanale-visual-studio-scene'&&!isPanel){onSceneChange(data.name,data.value);return true;}
   if(data.type==='humanale-visual-studio-region'&&!isPanel){onRegionSelect(data.region);return true;}
   return false;
  }
 });
}
