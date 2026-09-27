import {isRegionId} from '../brain/regions.js';

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const safeText=(value,max=120)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

export const NARA_UNIFIED_RUNTIME_CONTRACT=Object.freeze({
  version:1,
  runtimeVersion:3,
  roles:Object.freeze({
    naraCore:'brain',
    humanale:'body',
    visualStudio:'control-surface'
  }),
  bodyStates:Object.freeze(['idle','listening','thinking','working','speaking','warning']),
  rendererEvents:Object.freeze([
    'audio.energy',
    'vision.frame',
    'vision.stop',
    'speech.start',
    'speech.energy',
    'speech.stop',
    'brain.region.select'
  ]),
  outboundChannels:Object.freeze([
    'dudidam:runtime-state',
    'dudidam:nara-state',
    'dudidam:nara-voice'
  ]),
  authority:Object.freeze({
    mode:'owner-governed',
    renderer:'sensory-only',
    privilegedActions:'capability-broker',
    osElevation:'creator-plus-os-confirmation',
    credentialChanges:'authenticated-creator-only',
    arbitraryShell:false,
    authenticationBypass:false,
    rootExploit:false
  })
});

export function normalizeHumanALEInput(event,payload={}){
  const name=String(event||'');
  const value=payload&&typeof payload==='object'?payload:{};

  if(name==='audio.energy'){
    return Object.freeze({
      energy:clamp01(value.energy),
      low:clamp01(value.low),
      mid:clamp01(value.mid),
      high:clamp01(value.high)
    });
  }

  if(name==='vision.frame'){
    return Object.freeze({
      activity:clamp01(value.activity??1),
      frameId:value.frameId==null?null:safeText(value.frameId,120)
    });
  }

  if(name==='vision.stop'||name==='speech.stop'){
    return Object.freeze({});
  }

  if(name==='speech.start'||name==='speech.energy'){
    return Object.freeze({energy:clamp01(value.energy??.35)});
  }

  if(name==='brain.region.select'){
    const region=String(value.region||'');
    if(!isRegionId(region))return null;
    return Object.freeze({region});
  }

  return null;
}

export function projectRuntimeAuthority(core={}){
  const capabilities=core.engine?.capabilities||{};
  const pending=Array.isArray(capabilities.pending)?capabilities.pending:[];
  return Object.freeze({
    ...NARA_UNIFIED_RUNTIME_CONTRACT.authority,
    pendingCapabilities:pending.length,
    privilegedGrantCount:Array.isArray(capabilities.grants)?capabilities.grants.length:0
  });
}
