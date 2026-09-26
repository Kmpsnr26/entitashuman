const $=id=>document.getElementById(id);
let snapshot=null,regions={};
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
}

function appendEvent(envelope){
  const row=document.createElement('div');row.className='event-row';
  const time=new Date(envelope.timestamp||Date.now()).toLocaleTimeString('id-ID');
  row.innerHTML='<time>'+time+'</time><strong>'+escapeHtml(envelope.event)+'</strong><span>'+escapeHtml(JSON.stringify(envelope.payload||{}))+'</span>';
  $('events').prepend(row);
  while($('events').children.length>100)$('events').lastChild.remove();
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
  for(const event of data.events||[])appendEvent(event);

  const stream=new EventSource('/api/stream');
  stream.addEventListener('ready',()=>{$('connection').textContent='LIVE';$('connection').className='live';});
  stream.addEventListener('state',e=>renderState(JSON.parse(e.data)));
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
