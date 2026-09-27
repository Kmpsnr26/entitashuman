export const AI_AUTOPILOT_TRANSACTION_VERSION='1.0.0';

export const AI_AUTOPILOT_STATES=Object.freeze({
 IDLE:'IDLE',
 DETECTING:'DETECTING',
 DETECTED:'DETECTED',
 REPRODUCING:'REPRODUCING',
 REPRODUCED:'REPRODUCED',
 PATCHING:'PATCHING',
 PATCHED:'PATCHED',
 INSPECTING:'INSPECTING',
 INSPECTED:'INSPECTED',
 TESTING:'TESTING',
 TESTED:'TESTED',
 VERIFYING:'VERIFYING',
 PASSED:'PASSED',
 ROLLING_BACK:'ROLLING_BACK',
 ROLLED_BACK:'ROLLED_BACK',
 BLOCKED:'BLOCKED',
 FAILED:'FAILED'
});

export const AI_AUTOPILOT_REASONS=Object.freeze({
 NO_ISSUE:'NO_ISSUE',
 DETECTOR_ERROR:'DETECTOR_ERROR',
 REPRODUCTION_FAILED:'REPRODUCTION_FAILED',
 PATCH_BLOCKED:'PATCH_BLOCKED',
 PATCH_FAILED:'PATCH_FAILED',
 INSPECTION_BLOCKED:'INSPECTION_BLOCKED',
 TEST_FAILED:'TEST_FAILED',
 VERIFICATION_FAILED:'VERIFICATION_FAILED',
 RETRY_EXHAUSTED:'RETRY_EXHAUSTED',
 ROLLBACK_FAILED:'ROLLBACK_FAILED',
 INVALID_BROKER:'INVALID_BROKER',
 INVALID_RESULT:'INVALID_RESULT'
});

export const DEFAULT_AI_AUTOPILOT_LIMITS=Object.freeze({
 maxAttempts:2,
 historyLimit:100,
 maxSummaryLength:240
});

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;

function safeText(value,max=240){
 return String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
}

function redactAutopilotSummary(value,max=240){
 let text=safeText(value,max*2);
 text=text
  .replace(/\b(?:sk|sk-proj)-[A-Za-z0-9_-]{8,}\b/gi,'[REDACTED]')
  .replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/gi,'[REDACTED]')
  .replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/gi,'[REDACTED]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,'Bearer [REDACTED]')
  .replace(/\b(password|passwd|token|secret|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]');
 return safeText(text,max);
}

function normalizeLimits(overrides={}){
 const limits={...DEFAULT_AI_AUTOPILOT_LIMITS,...overrides};
 for(const key of Object.keys(DEFAULT_AI_AUTOPILOT_LIMITS)){
  if(!Number.isInteger(limits[key])||limits[key]<1){
   throw new TypeError(key+' must be a positive integer');
  }
 }
 return Object.freeze(limits);
}

function requireMethod(value,name){
 if(!value||typeof value[name]!=='function'){
  const error=new TypeError('Autopilot broker must expose '+name+'()');
  error.code='AI_AUTOPILOT_INVALID_BROKER';
  throw error;
 }
}

function publicStep(step){
 return Object.freeze({
  name:step.name,
  ok:step.ok,
  code:step.code??null,
  summary:step.summary??'',
  attempt:step.attempt,
  startedAt:step.startedAt,
  endedAt:step.endedAt,
  durationMs:step.durationMs
 });
}

function normalizeStepResult(name,raw,{maxSummaryLength}){
 if(raw===true)return {ok:true,code:'PASS',summary:name+' passed.'};
 if(raw===false)return {ok:false,code:'FAILED',summary:name+' failed.'};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){
  return {ok:false,code:'INVALID_RESULT',summary:name+' returned an invalid result.'};
 }
 const ok=raw.ok===true;
 const code=safeText(raw.code||(ok?'PASS':'FAILED'),80);
 const summary=redactAutopilotSummary(raw.summary||(ok?name+' passed.':name+' failed.'),maxSummaryLength);
 return {ok,code:SAFE_ID.test(code)?code:'INVALID_RESULT',summary};
}

export class AIAutopilotTransaction{
 constructor({
  broker,
  now=()=>Date.now(),
  idFactory=()=>('autopilot-'+Math.random().toString(36).slice(2)),
  limits={}
 }={}){
  for(const name of ['detect','reproduce','patch','inspect','test','verify','rollback']){
   requireMethod(broker,name);
  }
  this.broker=broker;
  this.now=now;
  this.idFactory=idFactory;
  this.limits=normalizeLimits(limits);
  this.state=AI_AUTOPILOT_STATES.IDLE;
  this.history=[];
  this.running=false;
  this.sequence=0;
 }

 transition(state,meta={}){
  this.state=state;
  const event=Object.freeze({
   sequence:++this.sequence,
   state,
   at:this.now(),
   attempt:meta.attempt??null,
   reason:meta.reason??null
  });
  this.history.push(event);
  while(this.history.length>this.limits.historyLimit)this.history.shift();
  return event;
 }

 async callStep(name,fn,attempt){
  const startedAt=this.now();
  try{
   const raw=await fn();
   const normalized=normalizeStepResult(name,raw,this.limits);
   const endedAt=this.now();
   return Object.freeze({
    name,
    ...normalized,
    attempt,
    startedAt,
    endedAt,
    durationMs:Math.max(0,endedAt-startedAt),
    raw:raw&&typeof raw==='object'?raw:null
   });
  }catch(error){
   const endedAt=this.now();
   return Object.freeze({
    name,
    ok:false,
    code:'STEP_ERROR',
    summary:redactAutopilotSummary(error?.message||error,this.limits.maxSummaryLength),
    attempt,
    startedAt,
    endedAt,
    durationMs:Math.max(0,endedAt-startedAt),
    raw:null
   });
  }
 }

 async rollback({transactionId,reason,attempt,steps}){
  this.transition(AI_AUTOPILOT_STATES.ROLLING_BACK,{attempt,reason});
  const result=await this.callStep('rollback',()=>this.broker.rollback({
   transactionId,
   reason,
   attempt
  }),attempt);
  steps.push(result);
  if(result.ok){
   this.transition(AI_AUTOPILOT_STATES.ROLLED_BACK,{attempt,reason});
   return {ok:true,result};
  }
  this.transition(AI_AUTOPILOT_STATES.FAILED,{
   attempt,
   reason:AI_AUTOPILOT_REASONS.ROLLBACK_FAILED
  });
  return {ok:false,result};
 }

 async runOnce({requestId=null,signal=null}={}){
  if(this.running){
   const error=new Error('Autopilot transaction already running.');
   error.code='AI_AUTOPILOT_BUSY';
   throw error;
  }
  this.running=true;
  const transactionId=safeText(requestId||this.idFactory(),120);
  if(!SAFE_ID.test(transactionId)){
   this.running=false;
   throw new TypeError('Invalid autopilot transaction id.');
  }

  const startedAt=this.now();
  const steps=[];
  let finalReason=null;
  let attempts=0;

  try{
   if(signal?.aborted){
    this.transition(AI_AUTOPILOT_STATES.BLOCKED,{reason:'ABORTED'});
    return this.finish({
     transactionId,startedAt,steps,attempts,
     status:AI_AUTOPILOT_STATES.BLOCKED,
     reason:'ABORTED'
    });
   }

   this.transition(AI_AUTOPILOT_STATES.DETECTING,{attempt:0});
   const detect=await this.callStep('detect',()=>this.broker.detect({
    transactionId,signal
   }),0);
   steps.push(detect);
   if(!detect.ok){
    finalReason=detect.code==='NO_ISSUE'
     ?AI_AUTOPILOT_REASONS.NO_ISSUE
     :AI_AUTOPILOT_REASONS.DETECTOR_ERROR;
    this.transition(
     finalReason===AI_AUTOPILOT_REASONS.NO_ISSUE
      ?AI_AUTOPILOT_STATES.IDLE
      :AI_AUTOPILOT_STATES.FAILED,
     {reason:finalReason}
    );
    return this.finish({
     transactionId,startedAt,steps,attempts,
     status:finalReason===AI_AUTOPILOT_REASONS.NO_ISSUE
      ?AI_AUTOPILOT_STATES.IDLE
      :AI_AUTOPILOT_STATES.FAILED,
     reason:finalReason
    });
   }
   this.transition(AI_AUTOPILOT_STATES.DETECTED,{attempt:0});

   for(let attempt=1;attempt<=this.limits.maxAttempts;attempt++){
    attempts=attempt;

    this.transition(AI_AUTOPILOT_STATES.REPRODUCING,{attempt});
    const reproduce=await this.callStep('reproduce',()=>this.broker.reproduce({
     transactionId,
     detection:detect.raw,
     attempt,
     signal
    }),attempt);
    steps.push(reproduce);
    if(!reproduce.ok){
     finalReason=AI_AUTOPILOT_REASONS.REPRODUCTION_FAILED;
     if(attempt<this.limits.maxAttempts)continue;
     this.transition(AI_AUTOPILOT_STATES.FAILED,{attempt,reason:finalReason});
     break;
    }
    this.transition(AI_AUTOPILOT_STATES.REPRODUCED,{attempt});

    this.transition(AI_AUTOPILOT_STATES.PATCHING,{attempt});
    const patch=await this.callStep('patch',()=>this.broker.patch({
     transactionId,
     detection:detect.raw,
     reproduction:reproduce.raw,
     attempt,
     signal
    }),attempt);
    steps.push(patch);
    if(!patch.ok){
     finalReason=patch.code==='BLOCKED'
      ?AI_AUTOPILOT_REASONS.PATCH_BLOCKED
      :AI_AUTOPILOT_REASONS.PATCH_FAILED;
     const rollback=await this.rollback({
      transactionId,reason:finalReason,attempt,steps
     });
     if(!rollback.ok)finalReason=AI_AUTOPILOT_REASONS.ROLLBACK_FAILED;
     if(attempt<this.limits.maxAttempts&&rollback.ok)continue;
     break;
    }
    this.transition(AI_AUTOPILOT_STATES.PATCHED,{attempt});

    this.transition(AI_AUTOPILOT_STATES.INSPECTING,{attempt});
    const inspect=await this.callStep('inspect',()=>this.broker.inspect({
     transactionId,
     attempt,
     patch:patch.raw,
     signal
    }),attempt);
    steps.push(inspect);
    if(!inspect.ok){
     finalReason=AI_AUTOPILOT_REASONS.INSPECTION_BLOCKED;
     const rollback=await this.rollback({
      transactionId,reason:finalReason,attempt,steps
     });
     if(!rollback.ok)finalReason=AI_AUTOPILOT_REASONS.ROLLBACK_FAILED;
     if(attempt<this.limits.maxAttempts&&rollback.ok)continue;
     break;
    }
    this.transition(AI_AUTOPILOT_STATES.INSPECTED,{attempt});

    this.transition(AI_AUTOPILOT_STATES.TESTING,{attempt});
    const test=await this.callStep('test',()=>this.broker.test({
     transactionId,
     attempt,
     signal
    }),attempt);
    steps.push(test);
    if(!test.ok){
     finalReason=AI_AUTOPILOT_REASONS.TEST_FAILED;
     const rollback=await this.rollback({
      transactionId,reason:finalReason,attempt,steps
     });
     if(!rollback.ok)finalReason=AI_AUTOPILOT_REASONS.ROLLBACK_FAILED;
     if(attempt<this.limits.maxAttempts&&rollback.ok)continue;
     break;
    }
    this.transition(AI_AUTOPILOT_STATES.TESTED,{attempt});

    this.transition(AI_AUTOPILOT_STATES.VERIFYING,{attempt});
    const verify=await this.callStep('verify',()=>this.broker.verify({
     transactionId,
     attempt,
     signal
    }),attempt);
    steps.push(verify);
    if(!verify.ok){
     finalReason=AI_AUTOPILOT_REASONS.VERIFICATION_FAILED;
     const rollback=await this.rollback({
      transactionId,reason:finalReason,attempt,steps
     });
     if(!rollback.ok)finalReason=AI_AUTOPILOT_REASONS.ROLLBACK_FAILED;
     if(attempt<this.limits.maxAttempts&&rollback.ok)continue;
     break;
    }

    this.transition(AI_AUTOPILOT_STATES.PASSED,{attempt});
    return this.finish({
     transactionId,startedAt,steps,attempts,
     status:AI_AUTOPILOT_STATES.PASSED,
     reason:null
    });
   }

   if(finalReason!==AI_AUTOPILOT_REASONS.ROLLBACK_FAILED&&
      attempts>=this.limits.maxAttempts){
    finalReason=finalReason||AI_AUTOPILOT_REASONS.RETRY_EXHAUSTED;
   }

   const status=this.state===AI_AUTOPILOT_STATES.ROLLED_BACK
    ?AI_AUTOPILOT_STATES.ROLLED_BACK
    :AI_AUTOPILOT_STATES.FAILED;
   return this.finish({
    transactionId,startedAt,steps,attempts,status,reason:finalReason
   });
  }finally{
   this.running=false;
  }
 }

 finish({transactionId,startedAt,steps,attempts,status,reason}){
  const endedAt=this.now();
  return Object.freeze({
   version:AI_AUTOPILOT_TRANSACTION_VERSION,
   transactionId,
   status,
   reason,
   attempts,
   startedAt,
   endedAt,
   durationMs:Math.max(0,endedAt-startedAt),
   steps:Object.freeze(steps.map(publicStep)),
   authority:Object.freeze({
    owner:false,
    creatorApproval:false,
    credentialAccess:false,
    gitPush:false,
    gitMerge:false,
    releasePublish:false,
    draftPr:false
   })
  });
 }

 snapshot(){
  return Object.freeze({
   version:AI_AUTOPILOT_TRANSACTION_VERSION,
   running:this.running,
   state:this.state,
   limits:this.limits,
   history:Object.freeze(this.history.map(item=>Object.freeze({...item})))
  });
 }
}

export function createAIAutopilotTransaction(options){
 return new AIAutopilotTransaction(options);
}
