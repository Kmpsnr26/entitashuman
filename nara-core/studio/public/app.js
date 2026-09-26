const $=id=>document.getElementById(id);
let snapshot=null,regions={},telemetry=null,skillsSnapshot=null;
let neural3d=null,neural3dLoading=null,studioView='2d';
let eventBuffer=[],eventPaused=false,replayTimer=null;
const connectionIds=['GITHUB','COPILOT','WEB','TEAM','PR','SYNC','ONLINE','OWNER_EMAIL','DRIVE'];
const eventSelect=$('eventSelect');

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function statusClass(status='idle'){return 's-'+String(status).replace(/[^a-z0-9_-]/gi,'');}
function formatClock(ts){return ts?new Date(ts).toLocaleTimeString('id-ID'):'—';}
function formatDuration(ms){
  if(ms===null||ms===undefined)return '—';
  if(ms<1000)return Math.round(ms)+' ms';
  if(ms<60000)return (ms/1000).toFixed(ms<10000?2:1)+' s';
  const min=Math.floor(ms/60000),sec=Math.floor((ms%60000)/1000);
  return min+'m '+sec+'s';
}

function updateViewButtons(){
  const is3d=studioView==='3d';
  $('view2d')?.classList.toggle('view-active',!is3d);
  $('view3d')?.classList.toggle('view-active',is3d);
}

function updateNeuralHud(){
  if(!$('neural3dSelected'))return;
  $('neural3dSelected').textContent=snapshot?.selectedRegion||'NARA_CORE';
  if(!neural3d)return;

  const stats=neural3d.getStats();
  $('neural3dRoots').textContent=stats.links+' living roots · '+stats.activeLinks+' active';
  $('neural3dRoutes').textContent='routes: '+stats.routeCount+' · active '+stats.activeRoutes;
  $('neural3dPerf').textContent='fps '+stats.fps+' · quality '+stats.quality+' · '+stats.mode;
  $('neural3dLastRoute').textContent='last route: '+(stats.lastRoute||'—');

  for(const [id,mode] of [['neuralExplorer','explorer'],['neuralFocus','focus'],['neuralCore','core']]){
    $(id)?.classList.toggle('mode-active',stats.mode===mode);
  }

  const detail=neural3d.getRegionDetails(snapshot?.selectedRegion||'NARA_CORE');
  if(detail){
    $('neuralDetailLabel').textContent=detail.label;
    $('neuralDetailId').textContent=detail.id;
    $('neuralDetailStatus').textContent=detail.status;
    $('neuralDetailGroup').textContent=detail.group;
    $('neuralDetailNeighbors').textContent='neighbors: '+(detail.neighbors.join(' · ')||'—');
  }
}

async function ensureNeural3D(){
  if(neural3d){
    neural3d.setRegions(regions);
    if(snapshot)neural3d.setState(snapshot);
    neural3d.resize();
    return neural3d;
  }
  if(neural3dLoading)return neural3dLoading;
  $('neural3dStatus').textContent='LOADING';
  neural3dLoading=import('./neural-space.js').then(({createNeural3DScene})=>{
    const host=$('neural3dHost');
    host.innerHTML='';
    neural3d=createNeural3DScene(host,{
      onSelect:region=>dispatch('brain.region.select',{region}).catch(error=>{
        $('consoleLog').textContent=error.message;
      }),
      onMetrics:()=>updateNeuralHud()
    });
    neural3d.setRegions(regions);
    if(snapshot)neural3d.setState(snapshot);
    $('neural3dStatus').textContent='LIVE · ROOT FLOW';
    updateNeuralHud();
    return neural3d;
  }).catch(error=>{
    $('neural3dStatus').textContent='3D UNAVAILABLE';
    $('neural3dHost').innerHTML='<div class="neural3d-error">Neural Space 3D gagal dimuat. Mode 2D tetap tersedia.<br>'+escapeHtml(error.message)+'</div>';
    $('consoleLog').textContent=error.stack||error.message;
    throw error;
  }).finally(()=>{neural3dLoading=null;});
  return neural3dLoading;
}

function setStudioView(mode){
  studioView=mode==='3d'?'3d':'2d';
  $('brainMap').hidden=studioView!=='2d';
  $('neural3d').hidden=studioView!=='3d';
  updateViewButtons();
  if(studioView==='3d'){
    ensureNeural3D().then(scene=>{scene.setActive(true);scene.resize();updateNeuralHud();}).catch(()=>{});
  }else{
    neural3d?.setActive(false);
    if(snapshot)drawBrain();
  }
}

function drawBrain(){
  const nodes=$('brainNodes'),svg=$('brainLines');
  nodes.innerHTML='';svg.innerHTML='';
  const rect=$('brainMap').getBoundingClientRect();
  const point={};
  for(const region of Object.values(regions)){
    const x=(region.position.x+.7)/1.4*100;
    const y=(region.position.y+.58)/1.16*100;
    point[region.id]={x:x/100*rect.width,y:y/100*rect.height};
    const el=document.createElement('button');
    const state=snapshot?.regions?.[region.id]||{};
    el.className='brain-node '+statusClass(state.status)+(snapshot?.selectedRegion===region.id?' selected':'');
    el.style.left=x+'%';el.style.top=y+'%';el.dataset.region=region.id;
    el.innerHTML='<strong>'+escapeHtml(region.label)+'</strong><span>'+escapeHtml(state.status||'idle')+'</span>';
    el.onclick=()=>dispatch('brain.region.select',{region:region.id});
    nodes.appendChild(el);
  }
  const seen=new Set();
  for(const region of Object.values(regions)){
    for(const target of region.connections||[]){
      if(!point[target])continue;
      const key=[region.id,target].sort().join(':');
      if(seen.has(key))continue;seen.add(key);
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',point[region.id].x);line.setAttribute('y1',point[region.id].y);
      line.setAttribute('x2',point[target].x);line.setAttribute('y2',point[target].y);
      svg.appendChild(line);
    }
  }
}

function renderState(state){
  snapshot=state;
  $('lifecycle').textContent=state.lifecycle||'—';
  $('selectedRegion').textContent=state.selectedRegion||'—';
  $('currentTask').textContent=state.currentTask?.label||'—';
  $('lastEvent').textContent=state.lastEvent?.event||'—';
  $('safetyState').textContent=state.regions?.SAFETY?.status||'—';
  $('hearing').value=state.sensory?.hearing?.energy||0;
  $('vision').value=state.sensory?.vision?.activity||0;
  $('speech').value=state.sensory?.speech?.energy||0;
  $('connections').innerHTML=connectionIds.map(id=>{
    const s=state.regions?.[id]?.status||'idle';
    return '<span class="chip '+statusClass(s)+'">'+escapeHtml(id)+' · '+escapeHtml(s)+'</span>';
  }).join('');
  drawBrain();
  if(neural3d){neural3d.setState(state);updateNeuralHud();}
  if(skillsSnapshot)renderSkills(skillsSnapshot);
  renderPerformance();
}

function matchingEvents(){
  const filter=String($('eventFilter')?.value||'').trim().toLowerCase();
  if(!filter)return eventBuffer;
  return eventBuffer.filter(item=>{
    const hay=(item.event+' '+JSON.stringify(item.payload||{})).toLowerCase();
    return hay.includes(filter);
  });
}

function renderEventItems(items){
  const rows=[...items].reverse().slice(0,120).map(envelope=>{
    const time=formatClock(envelope.timestamp||Date.now());
    return '<div class="event-row"><time>'+escapeHtml(time)+'</time><strong>'+escapeHtml(envelope.event)+'</strong><span>'+escapeHtml(JSON.stringify(envelope.payload||{}))+'</span></div>';
  });
  $('events').innerHTML=rows.join('')||'<div class="trace-empty">Belum ada event.</div>';
}

function renderEventView(){
  if(eventPaused||replayTimer)return;
  renderEventItems(matchingEvents());
}

function appendEvent(envelope){
  neural3d?.handleEvent(envelope);
  eventBuffer.push(envelope);
  if(eventBuffer.length>250)eventBuffer.splice(0,eventBuffer.length-250);
  renderEventView();
}

function stopReplay(){
  if(replayTimer){clearInterval(replayTimer);replayTimer=null;}
  $('replayEvents').textContent='Replay last 30';
}

function startReplay(){
  stopReplay();
  const sequence=matchingEvents().slice(-30);
  if(!sequence.length)return;
  eventPaused=true;
  $('pauseEvents').textContent='Resume';
  $('replayEvents').textContent='Stop replay';
  let index=0,shown=[];
  $('events').innerHTML='';
  replayTimer=setInterval(()=>{
    if(index>=sequence.length){
      stopReplay();
      return;
    }
    shown.push(sequence[index++]);
    renderEventItems(shown);
  },180);
}

const phaseElements={
  reason:['phaseReason','phaseReasonTime'],
  plan:['phasePlan','phasePlanTime'],
  agent:['phaseAgent','phaseAgentTime'],
  program:['phaseProgram','phaseProgramTime'],
  verify:['phaseVerify','phaseVerifyTime']
};

function renderTelemetry(data){
  telemetry=data||{};
  const decision=telemetry.decision||{};
  const history=Array.isArray(decision.history)?decision.history:[];
  $('decisionStatus').textContent=decision.status||'idle';
  $('decisionCurrent').textContent=decision.currentStage?.toUpperCase()||'—';
  $('decisionLabel').textContent=decision.currentLabel||'—';
  $('decisionCompleted').textContent=String(decision.completedStages||0);
  $('decisionFailed').textContent=String(decision.failedStages||0);

  for(const [stage,[statusId,timeId]] of Object.entries(phaseElements)){
    const active=decision.active?.[stage];
    const last=[...history].reverse().find(item=>item.stage===stage);
    const item=active||last,status=item?.status||'idle';
    $(statusId).textContent=status;
    $(timeId).textContent=item?.durationMs!==null&&item?.durationMs!==undefined?formatDuration(item.durationMs):(item?.startedAt?formatClock(item.startedAt):'—');
    const card=document.querySelector('.phase-card[data-stage="'+stage+'"]');
    if(card)card.className='phase-card p-'+status;
  }

  $('decisionHistory').innerHTML=[...history].reverse().slice(0,14).map(item=>
    '<div class="trace-row"><time>'+escapeHtml(formatClock(item.endedAt||item.startedAt))+'</time>'+
    '<strong>'+escapeHtml(item.stage.toUpperCase())+'</strong><span>'+escapeHtml(item.status)+'</span>'+
    '<span>'+escapeHtml(item.label||'')+'</span><em>'+escapeHtml(formatDuration(item.durationMs))+'</em></div>'
  ).join('')||'<div class="trace-empty">Belum ada decision trace.</div>';

  const memory=telemetry.memory||{},counters=memory.counters||{};
  $('memoryActivity').textContent=memory.active?'active':'idle';
  $('memoryReadCount').textContent=String(counters.read||0);
  $('memoryWriteCount').textContent=String(counters.write||0);
  $('memoryUsedCount').textContent=String(counters.context_used||0);
  $('memoryBlockedCount').textContent=String(counters.context_blocked||0);
  $('memoryLastOperation').textContent=memory.lastOperation?.operation||'—';
  $('memoryLastLabel').textContent=memory.lastOperation?.label||'No memory activity yet.';
  const memoryHistory=Array.isArray(memory.history)?memory.history:[];
  $('memoryHistory').innerHTML=[...memoryHistory].reverse().slice(0,16).map(item=>
    '<div class="trace-row memory-row"><time>'+escapeHtml(formatClock(item.timestamp))+'</time>'+
    '<strong>'+escapeHtml(item.operation)+'</strong><span>'+escapeHtml(item.target||'—')+'</span>'+
    '<span>'+escapeHtml(item.label||'')+'</span></div>'
  ).join('')||'<div class="trace-empty">Belum ada aktivitas memory.</div>';

  renderDiagnostics(telemetry.diagnostics||{});
  renderPerformance();
}

function renderDiagnostics(data){
  const counters=data.counters||{};
  $('bugStatus').textContent=data.status||'idle';
  $('bugErrors').textContent=String(counters.errors||0);
  $('bugDetected').textContent=String(counters.bugs||0);
  $('bugFixed').textContent=String(counters.fixed||0);
  $('bugVerified').textContent=String(counters.verified||0);
  $('bugCurrent').textContent=data.current?.message||'—';
  $('bugRepairDuration').textContent=formatDuration(data.lastRepairDurationMs);
  const history=Array.isArray(data.history)?data.history:[];
  $('bugHistory').innerHTML=[...history].reverse().slice(0,16).map(item=>
    '<div class="trace-row bug-row"><time>'+escapeHtml(formatClock(item.timestamp))+'</time>'+
    '<strong>'+escapeHtml(item.event)+'</strong><span>'+escapeHtml(item.status)+'</span>'+
    '<span>'+escapeHtml(item.message||'')+'</span></div>'
  ).join('')||'<div class="trace-empty">Belum ada diagnostic event.</div>';
}

function renderSkills(data){
  skillsSnapshot=data||{};
  const skills=Array.isArray(skillsSnapshot.skills)?skillsSnapshot.skills:[];
  $('skillSummary').textContent=(skillsSnapshot.total||skills.length)+' skills';
  $('skillEnabled').textContent=String(skillsSnapshot.enabled||0);
  $('skillRunning').textContent=String(skillsSnapshot.running||0);
  $('skillFailed').textContent=String(skillsSnapshot.failed||0);
  $('skillRows').innerHTML=skills.map(skill=>
    '<div class="skill-row"><strong>'+escapeHtml(skill.label)+'</strong><span>'+escapeHtml(skill.region||'—')+'</span>'+
    '<span class="skill-status '+statusClass(skill.status)+'">'+escapeHtml(skill.status)+'</span>'+
    '<span>'+escapeHtml(skill.runs)+'</span><span>'+escapeHtml(skill.lastEvent||'—')+'</span></div>'
  ).join('')||'<div class="trace-empty">Belum ada skill terdaftar.</div>';

  const agent=skills.find(skill=>skill.id==='agent.manage')||{},region=snapshot?.regions?.AGENT_MANAGER||{};
  const status=agent.status||region.status||'ready';
  $('agentStatus').textContent=status;
  $('agentCoreStatus').textContent=region.status||status;
  $('agentLabel').textContent=agent.lastLabel||region.message||'—';
  $('agentRuns').textContent=String(agent.runs||0);
  $('agentSuccess').textContent=String(agent.successes||0);
  $('agentFailures').textContent=String(agent.failures||0);
  $('agentDuration').textContent=formatDuration(agent.lastDurationMs);
  $('agentLastEvent').textContent=agent.lastEvent||region.lastEvent||'—';
  const core=document.querySelector('.agent-core');
  if(core)core.className='agent-core '+statusClass(status);
  renderPerformance();
}

function renderPerformance(){
  if(!$('perfTotalEvents'))return;
  const perf=telemetry?.performance||{},memory=telemetry?.memory?.counters||{};
  const regionStates=Object.values(snapshot?.regions||{});
  const active=regionStates.filter(item=>!['idle','ready','offline','disconnected','complete'].includes(item.status)).length;
  const skills=Array.isArray(skillsSnapshot?.skills)?skillsSnapshot.skills:[];
  const skillRuns=skills.reduce((sum,item)=>sum+(Number(item.runs)||0),0);
  $('perfTotalEvents').textContent=String(perf.totalEvents||0);
  $('perfRate').textContent=String(perf.eventsPerSecond||0);
  $('perfActiveRegions').textContent=String(active);
  const uptime=perf.startedAt?Math.max(0,Date.now()-perf.startedAt):(perf.uptimeMs||0);
  $('perfUptime').textContent=formatDuration(uptime);
  $('perfMemoryOps').textContent=String((memory.read||0)+(memory.write||0));
  $('perfSkillRuns').textContent=String(skillRuns);
  $('perfEventWindow').value=Math.min(100,Number(perf.events10s||0)*5);
}

async function dispatch(event,payload={}){
  $('consoleLog').textContent='Dispatching '+event+' ...';
  const res=await fetch('/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event,payload})});
  const data=await res.json();
  $('consoleLog').textContent=JSON.stringify(data,null,2);
  if(!res.ok)throw new Error(data.error||'Dispatch gagal');
  return data;
}

async function boot(){
  const data=await fetch('/api/snapshot').then(r=>r.json());
  regions=data.regions||{};
  $('brainSummary').textContent=Object.keys(regions).length+' regions';
  eventSelect.innerHTML=(data.studio?.eventAllowlist||[]).map(e=>'<option>'+escapeHtml(e)+'</option>').join('');
  renderState(data.state);
  renderTelemetry(data.telemetry);
  renderSkills(data.skills);
  for(const event of data.events||[])appendEvent(event);

  const stream=new EventSource('/api/stream');
  stream.addEventListener('ready',()=>{$('connection').textContent='LIVE';$('connection').className='live';});
  stream.addEventListener('state',e=>renderState(JSON.parse(e.data)));
  stream.addEventListener('telemetry',e=>renderTelemetry(JSON.parse(e.data)));
  stream.addEventListener('skills',e=>renderSkills(JSON.parse(e.data)));
  stream.addEventListener('event',e=>appendEvent(JSON.parse(e.data)));
  stream.onerror=()=>{$('connection').textContent='RECONNECTING';$('connection').className='warn';};
}

$('view2d').onclick=()=>setStudioView('2d');
$('view3d').onclick=()=>setStudioView('3d');
$('neuralExplorer').onclick=()=>ensureNeural3D().then(scene=>{scene.setMode('explorer');updateNeuralHud();}).catch(()=>{});
$('neuralFocus').onclick=()=>ensureNeural3D().then(scene=>{scene.setMode('focus');updateNeuralHud();}).catch(()=>{});
$('neuralCore').onclick=()=>ensureNeural3D().then(scene=>{scene.setMode('core');updateNeuralHud();}).catch(()=>{});
$('neuralReset').onclick=()=>ensureNeural3D().then(scene=>{scene.resetView();updateNeuralHud();}).catch(()=>{});
$('neuralQuality').onchange=event=>ensureNeural3D().then(scene=>{scene.setQuality(event.target.value);updateNeuralHud();}).catch(()=>{});
$('sendEvent').onclick=()=>dispatch(eventSelect.value,{label:$('eventLabel').value,message:$('eventLabel').value}).catch(e=>$('consoleLog').textContent=e.message);
document.querySelectorAll('.quick button').forEach(btn=>btn.onclick=()=>dispatch(btn.dataset.event,{label:'NARA Studio test',message:'NARA Studio simulated event'}).catch(e=>$('consoleLog').textContent=e.message));
$('clearEvents').onclick=()=>{stopReplay();eventBuffer=[];eventPaused=false;$('pauseEvents').textContent='Pause';renderEventItems([]);};
$('pauseEvents').onclick=()=>{stopReplay();eventPaused=!eventPaused;$('pauseEvents').textContent=eventPaused?'Resume':'Pause';if(!eventPaused)renderEventView();};
$('replayEvents').onclick=()=>replayTimer?stopReplay():startReplay();
$('eventFilter').addEventListener('input',()=>{if(!eventPaused&&!replayTimer)renderEventView();});
$('resetStudio').onclick=async()=>{const r=await fetch('/api/reset',{method:'POST'});const data=await r.json();$('consoleLog').textContent=JSON.stringify(data,null,2);};
window.addEventListener('resize',()=>{if(snapshot&&studioView==='2d')drawBrain();neural3d?.resize();});
setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString('id-ID');renderPerformance();},1000);
setStudioView('2d');
boot().catch(error=>{$('consoleLog').textContent=error.stack||error.message;$('connection').textContent='OFFLINE';});
