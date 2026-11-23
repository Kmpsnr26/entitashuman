const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));

export const HUMANALE_RENDER_MODES=Object.freeze(['eco','balanced','active']);
export const HUMANALE_STATES=Object.freeze(['idle','listening','thinking','speaking','processing','error']);

const PROCESSING_START_EVENTS=new Set([
  'observe.start','context.prepare','context.used','plan.start','agent.start',
  'memory.write','program.start','verify.start','work.start','sync.start'
]);
const COMPLETE_EVENTS=new Set([
  'observe.complete','reason.complete','plan.complete','agent.complete','memory.complete',
  'program.complete','verify.complete','work.complete','sync.complete','report.created','bug.fixed'
]);
const ERROR_EVENTS=new Set(['error.detected','bug.detected','agent.failed','work.failed','login.failed']);

function basePolicy(state='idle',reason='ale.idle',activity=0.08){
  const safeState=HUMANALE_STATES.includes(state)?state:'idle';
  const rendererMode=safeState==='idle'?'eco':safeState==='processing'?'balanced':'active';
  return Object.freeze({
    version:1,
    controlledBy:'ALECORE_AI',
    state:safeState,
    rendererMode,
    activity:clamp01(activity),
    reason:String(reason||'ale.idle').slice(0,120)
  });
}

export function createHumanALEPolicy(){
  return basePolicy();
}

function fallbackPolicy(runtime={},reason='ale.idle'){
  const sensory=runtime?.sensory||{};
  if(sensory?.speech?.active)return basePolicy('speaking',reason,Math.max(.65,clamp01(sensory.speech.energy)));
  if(sensory?.hearing?.active)return basePolicy('listening',reason,Math.max(.45,clamp01(sensory.hearing.energy)));
  if(runtime?.currentTask)return basePolicy('processing',reason,.72);
  return basePolicy('idle',reason,.08);
}

export function reduceHumanALEPolicy(previous=createHumanALEPolicy(),event='',payload={},runtime={}){
  const name=String(event||'');
  if(name==='provider.status'||name==='startup.connections')return previous;
  if(name==='ale.start')return basePolicy('idle',name,.12);
  if(name==='ale.shutdown')return basePolicy('idle',name,0);

  if(ERROR_EVENTS.has(name))return basePolicy('error',name,1);
  if(name==='reason.start')return basePolicy('thinking',name,1);
  if(PROCESSING_START_EVENTS.has(name))return basePolicy('processing',name,.85);

  if(name==='speech.start'||name==='speech.energy'){
    return basePolicy('speaking',name,Math.max(.65,clamp01(payload?.energy??.35)));
  }
  if(name==='speech.stop')return fallbackPolicy({...runtime,sensory:{...runtime?.sensory,speech:{active:false,energy:0}}},name);

  if(name==='hearing.start')return basePolicy('listening',name,.5);
  if(name==='hearing.stop')return fallbackPolicy({...runtime,sensory:{...runtime?.sensory,hearing:{active:false,energy:0}}},name);

  if(name==='audio.energy'){
    const energy=clamp01(payload?.energy);
    if(energy>.01)return basePolicy('listening',name,Math.max(.45,energy));
    return fallbackPolicy({...runtime,sensory:{...runtime?.sensory,hearing:{active:false,energy:0}}},name);
  }

  if(name==='vision.frame'){
    const current=previous?.state&&previous.state!=='idle'?previous:fallbackPolicy(runtime,name);
    if(current.state!=='idle')return Object.freeze({...current,reason:name});
    return Object.freeze({...basePolicy('idle',name,.22),rendererMode:'balanced'});
  }
  if(name==='vision.stop')return fallbackPolicy(runtime,name);

  if(name==='brain.region.select'){
    const current=previous?.state&&previous.state!=='idle'?previous:fallbackPolicy(runtime,name);
    return Object.freeze({...current,reason:name});
  }

  if(name==='work.complete'){
    return fallbackPolicy({...runtime,currentTask:null},name);
  }
  if(COMPLETE_EVENTS.has(name)){
    return fallbackPolicy(runtime,name);
  }

  if(name==='context.approved'||name==='context.blocked'||name==='memory.read'){
    return fallbackPolicy(runtime,name);
  }

  return Object.freeze({
    ...fallbackPolicy(runtime,name||previous?.reason||'ale.idle'),
    reason:name||previous?.reason||'ale.idle'
  });
}
