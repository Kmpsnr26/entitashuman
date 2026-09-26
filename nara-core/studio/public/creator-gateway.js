import {createCreatorBrainBackdrop} from './creator-brain.js';

const byId=id=>document.getElementById(id);

async function jsonFetch(url,options={}){
  const response=await fetch(url,{
    ...options,
    credentials:'same-origin',
    headers:{'content-type':'application/json',...(options.headers||{})}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data.error||('Request gagal: '+response.status));
    error.status=response.status;
    throw error;
  }
  return data;
}

function setCapability(id,state,detail=''){
  const row=document.querySelector('[data-capability="'+id+'"]');
  if(!row)return;
  row.dataset.state=state;
  row.querySelector('[data-cap-state]').textContent=String(state).replaceAll('_',' ').toUpperCase();
  row.querySelector('[data-cap-detail]').textContent=detail;
}

function renderCapabilities(items=[]){
  const host=byId('creatorCapabilityRows');
  if(!host)return;
  host.innerHTML='';
  for(const item of items){
    const row=document.createElement('div');
    row.className='creator-capability';
    row.dataset.capability=item.id;
    row.dataset.state=item.state;
    row.innerHTML='<span>'+item.label+'</span><strong data-cap-state>'+String(item.state).replaceAll('_',' ').toUpperCase()+'</strong><small data-cap-detail>'+item.authority+'</small>';
    host.appendChild(row);
  }
}

async function requestMediaPermissions(){
  if(!navigator.mediaDevices?.getUserMedia){
    setCapability('camera','unavailable','mediaDevices unavailable');
    setCapability('microphone','unavailable','mediaDevices unavailable');
    return;
  }
  setCapability('camera','requesting','browser permission');
  setCapability('microphone','requesting','browser permission');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    const video=stream.getVideoTracks().length>0;
    const audio=stream.getAudioTracks().length>0;
    setCapability('camera',video?'ready':'unavailable',video?'permission granted':'no camera track');
    setCapability('microphone',audio?'ready':'unavailable',audio?'permission granted':'no microphone track');
    for(const track of stream.getTracks())track.stop();
  }catch(error){
    const detail=error?.name||'permission denied';
    setCapability('camera','permission_required',detail);
    setCapability('microphone','permission_required',detail);
  }
}

async function primeAudio(){
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext){
    setCapability('audio','unavailable','Web Audio unavailable');
    return;
  }
  try{
    const context=new AudioContext();
    await context.resume();
    setCapability('audio',context.state==='running'?'ready':'available',context.state);
    await context.close();
  }catch(error){
    setCapability('audio','available',error?.name||'user activation required');
  }
}

export async function initializeCreatorGateway({onEntering=()=>{},onReady=()=>{}}={}){
  const gateway=byId('creatorGateway');
  const form=byId('creatorLoginForm');
  const status=byId('creatorLoginStatus');
  const enter=byId('creatorEnter');
  const logout=byId('creatorLogout');
  const brain=createCreatorBrainBackdrop(byId('creatorBrainCanvas'));

  let session=await jsonFetch('/api/creator/session',{method:'GET',headers:{}});

  async function unlock(current,{probe=false}={}){
    renderCapabilities(current.capabilities||[]);
    byId('creatorIdentity').textContent=current.development?'DEVELOPMENT CREATOR':'CREATOR VERIFIED';
    byId('creatorSessionMode').textContent=current.development?'AUTH NOT CONFIGURED':'SECURE SESSION';
    form.hidden=true;
    byId('creatorAccessPanel').hidden=false;
    brain.setState('verified');
    if(probe){
      await Promise.allSettled([requestMediaPermissions(),primeAudio()]);
    }
    enter.focus();
  }

  if(session.authenticated){
    await unlock(session,{probe:false});
  }else{
    gateway.hidden=false;
    form.hidden=false;
    byId('creatorAccessPanel').hidden=true;
  }

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    status.textContent='VERIFYING CREATOR IDENTITY…';
    brain.setState('verifying');
    const username=byId('creatorUsername').value;
    const password=byId('creatorPassword').value;
    try{
      const result=await jsonFetch('/api/creator/login',{
        method:'POST',
        body:JSON.stringify({username,password})
      });
      byId('creatorPassword').value='';
      session=await jsonFetch('/api/creator/session',{method:'GET',headers:{}});
      status.textContent=result.authenticated?'CREATOR AUTHENTICATED':'AUTH FAILED';
      await unlock(session,{probe:true});
    }catch(error){
      brain.setState('error');
      status.textContent=error.message;
    }
  });

  enter.addEventListener('click',async()=>{
    try{onEntering(session);}catch{}
    await Promise.allSettled([requestMediaPermissions(),primeAudio()]);
    brain.setState('verified');
    gateway.classList.add('creator-gateway-leaving');
    setTimeout(()=>{
      gateway.hidden=true;
      brain.setActive(false);
      document.body.classList.add('creator-session-active');
      onReady(session);
    },520);
  });

  logout?.addEventListener('click',async()=>{
    try{await jsonFetch('/api/creator/logout',{method:'POST',body:'{}'});}catch{}
    location.reload();
  });

  if(session.authenticated&&session.development){
    // Development mode keeps existing local workflows usable while still exercising the gateway UI.
    enter.textContent='ENTER DEVELOPMENT NEURAL SPACE';
  }

  gateway.hidden=false;
}
