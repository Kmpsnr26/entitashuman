const $=id=>document.getElementById(id);
let snapshot=null,regions={},telemetry=null,skillsSnapshot=null;
const connectionIds=['GITHUB','COPILOT','WEB','TEAM','PR','SYNC','ONLINE','OWNER_EMAIL','DRIVE'];
const eventSelect=$('eventSelect');

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function statusClass(status='idle'){return 's-'+String(status).replace(/[^a-z0-9_-]/gi,'');}

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
    el.style.left=x+'%';el.style.top=y+'%';
    el.dataset.region=region.id;
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
  if(skillsSnapshot)renderSkills(skillsSnapshot);
}

function appendEvent(envelope){
  const row=document.createElement('div');row.className='event-row';
  const time=new Date(envelope.timestamp||Date.now()).toLocaleTimeString('id-ID');
  row.innerHTML='<time>'+time+'</time><strong>'+escapeHtml(envelope.event)+'</strong><span>'+escapeHtml(JSON.stringify(envelope.payload||{}))+'</span>';
  $('events').prepend(row);
  while($('events').children.length>100)$('events').lastChild.remove();
}


const phaseElements={
  reason:['phaseReason','phaseReasonTime'],
  plan:['phasePlan','phasePlanTime'],
  agent:['phaseAgent','phaseAgentTime'],
  program:['phaseProgram','phaseProgramTime'],
  verify:['phaseVerify','phaseVerifyTime']
};

function formatDuration(ms){
  if(ms===null||ms===undefined)return '—';
  if(ms<1000)return Math.round(ms)+' ms';
  return (ms/1000).toFixed(ms<10000?2:1)+' s';
}

function formatClock(ts){
  return ts?new Date(ts).toLocaleTimeString('id-ID'):'—';
}

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
    const item=active||last;
    const status=item?.status||'idle';
    $(statusId).textContent=status;
    $(timeId).textContent=item?.durationMs!==null&&item?.durationMs!==undefined
      ?formatDuration(item.durationMs)
      :(item?.startedAt?formatClock(item.startedAt):'—');
    const card=document.querySelector('.phase-card[data-stage="'+stage+'"]');
    if(card)card.className='phase-card p-'+status;
  }

  $('decisionHistory').innerHTML=[...history].reverse().slice(0,14).map(item=>
    '<div class="trace-row"><time>'+escapeHtml(formatClock(item.endedAt||item.startedAt))+'</time>'+
    '<strong>'+escapeHtml(item.stage.toUpperCase())+'</strong>'+
    '<span>'+escapeHtml(item.status)+'</span>'+
    '<span>'+escapeHtml(item.label||'')+'</span>'+
    '<em>'+escapeHtml(formatDuration(item.durationMs))+'</em></div>'
  ).join('')||'<div class="trace-empty">Belum ada decision trace.</div>';

  const memory=telemetry.memory||{};
  const counters=memory.counters||{};
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
    '<strong>'+escapeHtml(item.operation)+'</strong>'+
    '<span>'+escapeHtml(item.target||'—')+'</span>'+
    '<span>'+escapeHtml(item.label||'')+'</span></div>'
  ).join('')||'<div class="trace-empty">Belum ada aktivitas memory.</div>';
}


function renderSkills(data){
  skillsSnapshot=data||{};
  const skills=Array.isArray(skillsSnapshot.skills)?skillsSnapshot.skills:[];
  $('skillSummary').textContent=(skillsSnapshot.total||skills.length)+' skills';
  $('skillEnabled').textContent=String(skillsSnapshot.enabled||0);
  $('skillRunning').textContent=String(skillsSnapshot.running||0);
  $('skillFailed').textContent=String(skillsSnapshot.failed||0);
  $('skillRows').innerHTML=skills.map(skill=>
    '<div class="skill-row">'+
    '<strong>'+escapeHtml(skill.label)+'</strong>'+
    '<span>'+escapeHtml(skill.region||'—')+'</span>'+
    '<span class="skill-status '+statusClass(skill.status)+'">'+escapeHtml(skill.status)+'</span>'+
    '<span>'+escapeHtml(skill.runs)+'</span>'+
    '<span>'+escapeHtml(skill.lastEvent||'—')+'</span>'+
    '</div>'
  ).join('')||'<div class="trace-empty">Belum ada skill terdaftar.</div>';

  const agent=skills.find(skill=>skill.id==='agent.manage')||{};
  const region=snapshot?.regions?.AGENT_MANAGER||{};
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

$('sendEvent').onclick=()=>dispatch(eventSelect.value,{label:$('eventLabel').value,message:$('eventLabel').value}).catch(e=>$('consoleLog').textContent=e.message);
document.querySelectorAll('.quick button').forEach(btn=>btn.onclick=()=>dispatch(btn.dataset.event,{label:'NARA Studio test',message:'NARA Studio simulated event'}).catch(e=>$('consoleLog').textContent=e.message));
$('clearEvents').onclick=()=>{$('events').innerHTML='';};
$('resetStudio').onclick=async()=>{const r=await fetch('/api/reset',{method:'POST'});$('consoleLog').textContent=JSON.stringify(await r.json(),null,2);};
window.addEventListener('resize',()=>snapshot&&drawBrain());
setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString('id-ID');},1000);
boot().catch(error=>{$('consoleLog').textContent=error.stack||error.message;$('connection').textContent='OFFLINE';});
