import {evaluateHumanALEVisualRealTestPreflight} from './humanale-visual-real-test.js';

export const HUMANALE_VISUAL_STUDIO_SNAPSHOT_KEY='humanale.visual-studio.snapshot.v1';
export const HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY='humanale.visual-studio.real-test-evidence.v1';

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
 const skills=Array.isArray(value?.skills)?value.skills:[];
 const skillCounts=value?.skillCounts&&typeof value.skillCounts==='object'?value.skillCounts:{};
 return {
  timestamp:Number(value?.timestamp)||Date.now(),
  runtime:{
   state:text(policy.state||'idle'),
   rendererMode:text(policy.rendererMode||'eco'),
   activity:Math.max(0,Math.min(1,Number(policy.activity)||0)),
   controlledBy:text(policy.controlledBy||'ALECORE_AI'),
   reason:text(policy.reason||'ale.idle')
  },
  ale:{
   lifecycle:text(ale.lifecycle||'idle'),
   selectedRegion:text(ale.selectedRegion||'ALECORE_AI'),
   currentTask:text(ale.currentTask||''),
   lastEvent:text(ale.lastEvent||'')
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
  })),
  skills:skills.slice(0,40).map(skill=>({
   id:text(skill?.id).slice(0,48),
   label:text(skill?.label).slice(0,80),
   group:text(skill?.group||'capability').slice(0,30),
   region:text(skill?.region||'ALECORE_AI').slice(0,40),
   state:text(skill?.state||'setup').slice(0,24),
   regionStatus:text(skill?.regionStatus||'idle').slice(0,24),
   activity:Math.max(0,Math.min(1,Number(skill?.activity)||0)),
   message:text(skill?.message||'').slice(0,160),
   dependencies:Array.isArray(skill?.dependencies)?skill.dependencies.map(item=>String(item).slice(0,48)).slice(0,12):[],
   missingDependencies:Array.isArray(skill?.missingDependencies)?skill.missingDependencies.map(item=>String(item).slice(0,48)).slice(0,12):[],
   permissions:Array.isArray(skill?.permissions)?skill.permissions.map(item=>String(item).slice(0,80)).slice(0,16):[],
   dependencyOk:skill?.dependencyOk!==false,
   testScenario:skill?.testScenario?String(skill.testScenario).slice(0,40):null
  })),
  skillCounts:{
   total:Math.max(0,Math.round(Number(skillCounts.total)||skills.length)),
   ready:Math.max(0,Math.round(Number(skillCounts.ready)||0)),
   running:Math.max(0,Math.round(Number(skillCounts.running)||0)),
   blocked:Math.max(0,Math.round(Number(skillCounts.blocked)||0)),
   error:Math.max(0,Math.round(Number(skillCounts.error)||0)),
   offline:Math.max(0,Math.round(Number(skillCounts.offline)||0)),
   setup:Math.max(0,Math.round(Number(skillCounts.setup)||0))
  }
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
 onTestScenario=async()=>({error:'Controlled test tidak tersedia.'}),
 onRefresh=async()=>{},
 onToast=()=>{}
}={}){
 let current=safeSnapshot(getSnapshot?.());
 let performanceHistory=[];
 let lastHistoryAt=0;
 let testHistory=[];
 let testRunning=false;
 let selectedSkillId='';
 let realTestEvidence={};
 try{realTestEvidence=JSON.parse(storage?.getItem?.(HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY)||'{}')||{};}catch{realTestEvidence={};}

 const liveSnapshot=()=>isPanel?current:(getSnapshot?.()||current);

 const render=value=>{
  current=safeSnapshot(value);
  setText(root,'visualStudioState',current.runtime.state.toUpperCase());
  setText(root,'visualStudioRenderer',current.runtime.rendererMode.toUpperCase());
  setText(root,'visualStudioActivity',percent(current.runtime.activity));
  setText(root,'visualStudioController',current.runtime.controlledBy);
  setText(root,'visualStudioReason',current.runtime.reason);
  setText(root,'visualStudioLifecycle',current.ale.lifecycle.toUpperCase());
  setText(root,'visualStudioRegion',current.ale.selectedRegion);
  setText(root,'visualStudioTask',current.ale.currentTask);
  setText(root,'visualStudioEvent',current.ale.lastEvent);
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

  setText(root,'visualStudioSkillTotal',current.skillCounts.total);
  setText(root,'visualStudioSkillReady',current.skillCounts.ready);
  setText(root,'visualStudioSkillRunning',current.skillCounts.running);
  setText(root,'visualStudioSkillBlocked',current.skillCounts.blocked);
  setText(root,'visualStudioSkillError',current.skillCounts.error);
  setText(root,'visualStudioSkillSetup',current.skillCounts.setup);
  renderList(root,'visualStudioSkills',current.skills,'visual-studio-skill',skill=>({
   text:skill.label+'\n'+skill.state.toUpperCase()+' · '+skill.region,
   dataset:{skillId:skill.id,state:skill.state},
   title:skill.message||skill.label
  }));
  if(selectedSkillId&&!current.skills.some(skill=>skill.id===selectedSkillId))selectedSkillId='';
  if(!selectedSkillId&&current.skills.length)selectedSkillId=current.skills[0].id;
  const selectedSkill=current.skills.find(skill=>skill.id===selectedSkillId);
  const skillInspector=root.querySelector?.('#visualStudioSkillInspector');
  if(skillInspector){
   skillInspector.replaceChildren();
   if(selectedSkill){
    const dl=root.createElement?.('dl')||document.createElement('dl');
    const entries=[
     ['Skill',selectedSkill.label+' ('+selectedSkill.id+')'],
     ['State',selectedSkill.state.toUpperCase()+' · activity '+Math.round(selectedSkill.activity*100)+'%'],
     ['Owner region',selectedSkill.region+' / '+selectedSkill.regionStatus.toUpperCase()],
     ['Dependencies',selectedSkill.dependencies.length?selectedSkill.dependencies.join(', '):'none'],
     ['Dependency health',selectedSkill.dependencyOk?'READY':'BLOCKED: '+selectedSkill.missingDependencies.join(', ')],
     ['Permissions',selectedSkill.permissions.length?selectedSkill.permissions.join(', '):'none'],
     ['Message',selectedSkill.message||'—']
    ];
    for(const [name,value] of entries){
     const dt=root.createElement?.('dt')||document.createElement('dt');
     const dd=root.createElement?.('dd')||document.createElement('dd');
     dt.textContent=name;dd.textContent=value;dl.append(dt,dd);
    }
    skillInspector.append(dl);
    if(selectedSkill.testScenario){
     const actions=root.createElement?.('div')||document.createElement('div');
     actions.className='actions';
     const button=root.createElement?.('button')||document.createElement('button');
     button.type='button';button.dataset.skillTest=selectedSkill.id;
     button.dataset.scenario=selectedSkill.testScenario;
     button.textContent='Controlled Test · '+selectedSkill.testScenario;
     actions.append(button);skillInspector.append(actions);
    }
   }else{
    const p=root.createElement?.('p')||document.createElement('p');
    p.className='fine';p.textContent='Skill snapshot belum tersedia.';skillInspector.append(p);
   }
  }

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
  renderRealTestPreflight();
  return current;
 };

 const renderTestTrace=(result={},baselineFps=0)=>{
  const host=root.querySelector?.('#visualStudioTestTrace');
  if(host){
   host.replaceChildren();
   for(const item of Array.isArray(result.trace)?result.trace.slice(0,16):[]){
    const row=root.createElement?.('div')||document.createElement('div');
    row.className='visual-studio-test-step';
    row.textContent=item.event+' → '+String(item.state||'').toUpperCase()+' / '+String(item.rendererMode||'').toUpperCase()+' · '+Math.round((Number(item.activity)||0)*100)+'%';
    host.append(row);
   }
  }
  const finalFps=current.performance.fps;
  const delta=finalFps-baselineFps;
  setText(root,'visualStudioTestStatus',result.error?'FAILED · '+result.error:(result.restored?'PASS · runtime restored to IDLE/ECO':'WARN · test selesai tetapi restore belum terkonfirmasi')+' · '+Number(result.durationMs||0)+' ms · FPS Δ '+(delta>=0?'+':'')+delta);
 };
 const renderTestHistory=()=>{
  const host=root.querySelector?.('#visualStudioTestHistory');
  if(!host)return;
  host.replaceChildren();
  for(const item of [...testHistory].reverse()){
   const row=root.createElement?.('div')||document.createElement('div');
   row.className='visual-studio-test-history-row';
   row.dataset.status=item.ok?'pass':'fail';
   row.textContent=item.scenario.toUpperCase()+' · '+(item.ok?'PASS':'FAIL')+' · '+item.durationMs+' ms · '+new Date(item.timestamp).toLocaleTimeString('id-ID');
   host.append(row);
  }
 };
 const runHealthScan=()=>{
  const snapshot=safeSnapshot(liveSnapshot());
  const badConnections=snapshot.connections.filter(item=>['error','bug'].includes(item.status));
  const checks=[
   {name:'AleCore AI authority',status:snapshot.runtime.controlledBy==='ALECORE_AI'?'PASS':'FAIL',detail:snapshot.runtime.controlledBy},
   {name:'AleCore AI lifecycle',status:snapshot.ale.lifecycle==='active'?'PASS':'WARN',detail:snapshot.ale.lifecycle},
   {name:'Renderer telemetry',status:snapshot.performance.fps>0&&snapshot.performance.points>0?'PASS':'WARN',detail:snapshot.performance.fps+' FPS / '+snapshot.performance.points+' points'},
   {name:'Runtime errors',status:snapshot.health.errorCount===0?'PASS':'FAIL',detail:snapshot.health.errorCount+' active'},
   {name:'Connection errors',status:badConnections.length===0?'PASS':'WARN',detail:badConnections.length?badConnections.map(item=>item.id).join(', '):'none'},
   {name:'Bounded performance history',status:performanceHistory.length<=30?'PASS':'FAIL',detail:performanceHistory.length+'/30 samples'}
  ];
  const host=root.querySelector?.('#visualStudioHealthChecks');
  if(host){
   host.replaceChildren();
   for(const check of checks){
    const row=root.createElement?.('div')||document.createElement('div');
    row.className='visual-studio-health-row';
    row.dataset.status=check.status.toLowerCase();
    row.textContent=check.status+' · '+check.name+' · '+check.detail;
    host.append(row);
   }
  }
  return checks;
 };

 const renderRealTestPreflight=()=>{
  const result=evaluateHumanALEVisualRealTestPreflight({snapshot:current,testHistory,evidence:realTestEvidence});
  setText(root,'visualStudioRealTestStatus',result.state+' · '+result.counts.pass+'/'+result.counts.total+' PASS · real-device pending '+result.counts.realDevicePending);
  const dialog=root.querySelector?.('#humanaleVisualStudio');
  if(dialog)dialog.dataset.realTest=result.state.toLowerCase();
  const host=root.querySelector?.('#visualStudioRealTestChecks');
  if(host){
   host.replaceChildren();
   for(const check of result.checks){
    const row=root.createElement?.('div')||document.createElement('div');
    row.className='visual-studio-real-test-row';row.dataset.status=check.status;row.dataset.kind=check.kind;
    const label=root.createElement?.('div')||document.createElement('div');
    label.className='visual-studio-real-test-label';
    const title=root.createElement?.('strong')||document.createElement('strong');title.textContent=check.label;
    const meta=root.createElement?.('small')||document.createElement('small');meta.textContent=check.kind==='automated'?'AUTOMATED · '+check.status.toUpperCase():'REAL DEVICE · '+check.status.toUpperCase();
    const note=root.createElement?.('small')||document.createElement('small');note.textContent=check.note||'Belum ada bukti.';
    label.append(title,meta,note);row.append(label);
    if(check.kind==='real-device'){
     const select=root.createElement?.('select')||document.createElement('select');select.dataset.realTestCheck=check.id;select.setAttribute('aria-label','Status '+check.label);
     for(const value of ['pending','pass','fail','blocked']){const option=root.createElement?.('option')||document.createElement('option');option.value=value;option.textContent=value.toUpperCase();option.selected=value===check.status;select.append(option);}
     row.append(select);
    }
    host.append(row);
   }
  }
  return result;
 };

 const syncPayload=()=>({type:'humanale-visual-studio-sync',snapshot:safeSnapshot(liveSnapshot())});

 root.querySelector?.('#humanaleVisualStudioOpen')?.addEventListener('click',()=>onOpen());
 root.querySelector?.('#visualStudioRefresh')?.addEventListener('click',async()=>{
  if(isPanel&&channel?.postMessage){channel.postMessage({type:'humanale-visual-studio-request',force:true});return;}
  try{await onRefresh(true);}catch{}
  render(getSnapshot?.());
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
 root.querySelector?.('#visualStudioSkills')?.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-skill-id]');
  if(!button?.dataset?.skillId)return;
  selectedSkillId=button.dataset.skillId;
  render(current);
 });
 root.querySelector?.('#visualStudioSkillInspector')?.addEventListener('click',async event=>{
  const button=event.target?.closest?.('[data-skill-test]');
  const scenario=button?.dataset?.scenario;
  if(!scenario||testRunning)return;
  const buttons=[...(root.querySelectorAll?.('[data-alecore-ai-test],[data-skill-test]')||[])];
  testRunning=true;buttons.forEach(item=>item.disabled=true);
  const baselineFps=current.performance.fps;
  setText(root,'visualStudioTestStatus','RUNNING · SKILL '+String(button.dataset.skillTest||'').toUpperCase()+' · '+scenario.toUpperCase());
  try{
   const result=await onTestScenario(scenario);
   render(liveSnapshot());
   renderTestTrace(result||{},baselineFps);
   testHistory=[...testHistory,{scenario:'skill:'+String(button.dataset.skillTest||scenario),ok:Boolean(result?.ok&&result?.restored),durationMs:Math.max(0,Math.round(Number(result?.durationMs)||0)),timestamp:Date.now()}].slice(-12);
   renderTestHistory();
  }catch(error){
   renderTestTrace({error:error?.message||'Skill test gagal.',trace:[],durationMs:0},baselineFps);
  }finally{
   testRunning=false;buttons.forEach(item=>item.disabled=false);
  }
 });

 root.querySelector?.('#visualStudioHealthScan')?.addEventListener('click',()=>runHealthScan());
 root.querySelector?.('#visualStudioRealTestPreflight')?.addEventListener('click',()=>renderRealTestPreflight());
 root.querySelector?.('#visualStudioRealTestReset')?.addEventListener('click',()=>{realTestEvidence={};try{storage?.removeItem?.(HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY);}catch{}renderRealTestPreflight();});
 root.querySelector?.('#visualStudioRealTestChecks')?.addEventListener('change',event=>{
  const select=event.target?.closest?.('[data-real-test-check]');
  const id=select?.dataset?.realTestCheck;if(!id)return;
  realTestEvidence={...realTestEvidence,[id]:{status:String(select.value||'pending'),source:'operator-local',note:'Dicatat dari HumanALE Visual Studio pada perangkat uji.',timestamp:Date.now()}};
  try{storage?.setItem?.(HUMANALE_VISUAL_REAL_TEST_EVIDENCE_KEY,JSON.stringify(realTestEvidence));}catch{}
  renderRealTestPreflight();
 });
 for(const button of root.querySelectorAll?.('[data-alecore-ai-test]')||[]){
  button.addEventListener('click',async()=>{
   if(testRunning)return;
   const scenario=String(button.dataset.aleTest||'');
   const buttons=[...(root.querySelectorAll?.('[data-alecore-ai-test]')||[])];
   const baselineFps=current.performance.fps;
   testRunning=true;buttons.forEach(item=>item.disabled=true);
   setText(root,'visualStudioTestStatus','RUNNING · '+scenario.toUpperCase()+' · AleCore AI mengendalikan transisi…');
   try{
    const result=await onTestScenario(scenario);
    render(liveSnapshot());
    renderTestTrace(result||{},baselineFps);
    testHistory=[...testHistory,{
     scenario:scenario||'unknown',
     ok:Boolean(result?.ok&&result?.restored),
     durationMs:Math.max(0,Math.round(Number(result?.durationMs)||0)),
     timestamp:Date.now()
    }].slice(-12);
    renderTestHistory();
   }catch(error){
    const result={error:error?.message||'Controlled test gagal.',trace:[],durationMs:0};
    renderTestTrace(result,baselineFps);
    testHistory=[...testHistory,{scenario:scenario||'unknown',ok:false,durationMs:0,timestamp:Date.now()}].slice(-12);
    renderTestHistory();
   }finally{
    testRunning=false;buttons.forEach(item=>item.disabled=false);
   }
  });
 }

 return Object.freeze({
  render,
  current:()=>safeSnapshot(current),
  syncPayload,
  runHealthScan,
  realTestPreflight:()=>renderRealTestPreflight(),
  realTestEvidence:()=>JSON.parse(JSON.stringify(realTestEvidence)),
  testHistory:()=>testHistory.map(item=>({...item})),
  handleMessage(data={}){
   if(data.type==='humanale-visual-studio-sync'){render(data.snapshot);return true;}
   if(data.type==='humanale-visual-studio-request'&&!isPanel){
    Promise.resolve(onRefresh(Boolean(data.force))).catch(()=>{}).finally(()=>channel?.postMessage?.(syncPayload()));
    return true;
   }
   if(data.type==='humanale-visual-studio-open-avatar'&&!isPanel){onOpenAvatarStudio();return true;}
   if(data.type==='humanale-visual-studio-scene'&&!isPanel){onSceneChange(data.name,data.value);return true;}
   if(data.type==='humanale-visual-studio-region'&&!isPanel){onRegionSelect(data.region);return true;}
   return false;
  }
 });
}
