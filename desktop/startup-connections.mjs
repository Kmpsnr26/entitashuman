import {normalizeProviderStatus,normalizeStartupConnections} from '../nara-core/brain/provider-state.js';

export const AUTO_PROVIDER_IDS=Object.freeze(['alecore-local','chatgpt','copilot','openai','gemini']);
export const STARTUP_STATUS_TIMEOUT_MS=15000;
const providerSessions=new WeakMap();
const codexStatusError=(agent,fallback='')=>fallback||
  (/^CODEX_PROBE_/.test(agent?.errorCode||'')?(agent.errorCode==='CODEX_PROBE_TIMEOUT'?'STATUS_TIMEOUT':'STATUS_FAILED'):'');

export function recordNaraAgentHubStatus({nara,hub={},pending=false,now=()=>Date.now(),statusError=''}={}){
  const codex=Array.isArray(hub.agents)?hub.agents.find(agent=>agent?.id==='codex'):null;
  const verified=codex?.executable===true&&codex?.state==='configured'&&codex?.canRun===true;
  const provider=normalizeProviderStatus({id:'codex',attached:codex?.executable===true,
    configured:verified,verified,busy:pending,evidence:'login-status',statusError:codexStatusError(codex,statusError)});
  safeDispatch(nara,'provider.status',provider);
  const authenticatedExecutors=[];
  if(provider.ready)authenticatedExecutors.push('codex');
  if(nara&&providerSessions.get(nara)?.get('copilot')?.ready)authenticatedExecutors.push('github-copilot');
  const startupConnections=normalizeStartupConnections({pending:false,checkedAt:now(),
    projectRootReady:hub.workReady??hub.projectRootReady,authenticatedExecutors});
  safeDispatch(nara,'startup.connections',startupConnections);
  return {provider,startupConnections};
}

function safeDispatch(nara,event,payload){
  try{nara?.dispatch?.(event,payload,{source:'startup-connections'});}catch{}
}

export function recordNaraProviderStatus({nara,id,raw={},busy=false,statusError='',requestSucceeded=false,requestFailed=false,clearEvidence=false}={}){
  if(!normalizeProviderStatus({id}))return null;
  const canStore=nara!==null&&['object','function'].includes(typeof nara);
  const session=canStore?providerSessions.get(nara)||new Map():new Map();
  const previous=session.get(id);
  const suppliedConfiguration=typeof raw?.configured==='boolean';
  const configured=requestSucceeded||
    (suppliedConfiguration?raw.configured:previous?.configured===true);
  const statusFailure=statusError||raw?.statusError||'';
  const localLogin=id==='chatgpt'&&configured&&!raw?.busy&&!busy;
  const copilotEvidence=id==='copilot'&&raw?.verified===true;
  const explicitlyUnverified=clearEvidence||
    (id==='copilot'&&raw?.verified===false);
  const previousSuccess=previous?.verified===true&&previous.evidence==='successful-request';
  const verified=!requestFailed&&!explicitlyUnverified&&
    (requestSucceeded||copilotEvidence||localLogin||(previousSuccess&&configured));
  const effectiveError=requestFailed?'STATUS_FAILED':
    statusFailure||(!verified&&configured?previous?.statusError||'':'');
  const state=normalizeProviderStatus({
    id,attached:statusError!=='BRIDGE_MISSING',configured,
    busy:busy||raw?.busy===true,verified,statusError:effectiveError,
    evidence:requestSucceeded||copilotEvidence||(previousSuccess&&verified)?'successful-request':
      id==='chatgpt'?'login-status':'none'
  });
  session.set(id,state);
  if(canStore)providerSessions.set(nara,session);
  safeDispatch(nara,'provider.status',state);
  return state;
}

async function boundedStatus(read,timeoutMs){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(read).then(raw=>({raw}),()=>({statusError:'STATUS_FAILED'})),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({statusError:'STATUS_TIMEOUT'}),timeoutMs);})
    ]);
  }finally{clearTimeout(timer);}
}

export async function bootstrapNaraConnections({bridges={},agentHub=null,nara=null,
  timeoutMs=STARTUP_STATUS_TIMEOUT_MS,now=()=>Date.now()}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>STARTUP_STATUS_TIMEOUT_MS){
    throw new TypeError('Startup status timeout must be between 1 and 15000 milliseconds.');
  }
  const [entries,hubResult]=await Promise.all([
    Promise.all(AUTO_PROVIDER_IDS.map(async id=>{
      const bridge=bridges[id];
      const result=typeof bridge?.status==='function'
        ?await boundedStatus(()=>bridge.status(),timeoutMs):{statusError:'BRIDGE_MISSING'};
      const state=recordNaraProviderStatus({nara,id,raw:result.raw,
        busy:bridge?.pending===true,statusError:result.statusError});
      return [id,state];
    })),
    typeof agentHub?.status==='function'?boundedStatus(()=>agentHub.status(),timeoutMs):Promise.resolve({})
  ]);
  const providers=Object.fromEntries(entries);
  const hub=hubResult.raw||{};
  const codex=Array.isArray(hub.agents)?hub.agents.find(agent=>agent?.id==='codex'):null;
  const codexVerified=codex?.executable===true&&codex?.state==='configured'&&codex?.canRun===true;
  providers.codex=normalizeProviderStatus({
    id:'codex',attached:codex?.executable===true,configured:codexVerified,
    verified:codexVerified,busy:agentHub?.pending===true,
    evidence:'login-status',statusError:codexStatusError(codex,hubResult.statusError)
  });
  safeDispatch(nara,'provider.status',providers.codex);
  const authenticatedExecutors=[];
  if(providers.codex.ready)authenticatedExecutors.push('codex');
  if(providers.copilot.ready)authenticatedExecutors.push('github-copilot');
  const startupConnections=normalizeStartupConnections({
    pending:false,checkedAt:now(),projectRootReady:hub.workReady??hub.projectRootReady,
    authenticatedExecutors
  });
  safeDispatch(nara,'startup.connections',startupConnections);
  return Object.freeze({providers:Object.freeze(providers),startupConnections});
}
