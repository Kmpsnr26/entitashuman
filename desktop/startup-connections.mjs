const AUTO_PROVIDER_IDS=Object.freeze(['chatgpt','copilot','openai','gemini']);

const clean=value=>String(value??'').trim().slice(0,240);

function providerState(id,raw={},error=''){
  const configured=Boolean(raw?.configured);
  const busy=Boolean(raw?.busy);
  return Object.freeze({
    id,
    attached:true,
    configured,
    ready:configured&&!busy&&!error,
    busy,
    mode:clean(raw?.mode),
    model:clean(raw?.model),
    verified:Boolean(raw?.verified),
    auth:id==='copilot'&&configured&&!raw?.verified?'deferred':configured?'available':'missing',
    error:clean(error)
  });
}

function unavailableProvider(id,error=''){
  return Object.freeze({
    id,
    attached:false,
    configured:false,
    ready:false,
    busy:false,
    mode:'',
    model:'',
    verified:false,
    auth:'missing',
    error:clean(error)
  });
}

function safeDispatch(nara,event,payload){
  try{return nara?.dispatch?.(event,payload,{source:'startup-connections'})||null;}
  catch{return null;}
}

export async function bootstrapNaraConnections({bridges={},agentHub=null,nara=null,logger=console}={}){
  const entries=await Promise.all(AUTO_PROVIDER_IDS.map(async id=>{
    const bridge=bridges?.[id];
    if(!bridge?.status)return [id,unavailableProvider(id,'Bridge tidak tersedia.')];
    try{return [id,providerState(id,await bridge.status())];}
    catch(error){return [id,unavailableProvider(id,error?.message||'Pemeriksaan provider gagal.')];}
  }));
  const providers=Object.fromEntries(entries);

  let hub={projectRoot:'',projectRootReady:false,agents:[]};
  try{
    const status=await agentHub?.status?.();
    if(status&&typeof status==='object')hub=status;
  }catch(error){
    logger?.warn?.('[NARA AUTO CONNECT] Agent Hub status gagal:',error?.message||error);
  }

  const agents=Array.isArray(hub?.agents)?hub.agents:[];
  const codex=agents.find(item=>item?.id==='codex');
  providers.codex=codex?Object.freeze({
    id:'codex',
    attached:Boolean(codex.executable),
    configured:codex.state==='configured',
    ready:Boolean(codex.canRun),
    busy:false,
    mode:'codex-cli',
    model:'OpenAI Codex',
    verified:Boolean(codex.canRun),
    auth:codex.canRun?'available':codex.executable?'login_required':'missing',
    error:''
  }):unavailableProvider('codex','Codex belum terdeteksi oleh Agent Hub.');

  const orchestrator=agents.find(item=>item?.id==='humanale-orchestrator');
  const executors=agents
    .filter(item=>['github-copilot','codex','cursor','claude'].includes(item?.id)&&item?.canRun)
    .map(item=>item.id);

  const autopilot=Object.freeze({
    ready:Boolean(orchestrator?.canRun),
    armed:Boolean(orchestrator?.canRun),
    mode:'bounded',
    projectRootReady:Boolean(hub?.projectRootReady),
    executors:Object.freeze([...executors]),
    detail:clean(orchestrator?.detail||'Autopilot menunggu executor lokal yang aman.')
  });

  for(const state of Object.values(providers))safeDispatch(nara,'provider.status',state);
  safeDispatch(nara,'autopilot.status',autopilot);

  const summary=Object.freeze({
    checkedAt:Date.now(),
    providers:Object.freeze({...providers}),
    autopilot
  });
  logger?.info?.('[NARA AUTO CONNECT]',JSON.stringify({
    readyProviders:Object.values(providers).filter(item=>item.ready).map(item=>item.id),
    autopilot:autopilot.ready,
    executors
  }));
  return summary;
}

export {AUTO_PROVIDER_IDS};
