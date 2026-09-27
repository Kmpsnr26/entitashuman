import {randomUUID} from 'node:crypto';
import {
  VERIFICATION_ENGINE_VERSION,
  VERIFICATION_VERDICTS,
  VERIFICATION_REASONS,
  DEFAULT_VERIFICATION_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function isPlainObject(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
}

function isJsonCompatible(value,seen=new WeakSet(),depth=0){
  if(depth>16)return false;
  if(value===null)return true;
  if(typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object')return false;
  if(seen.has(value))return false;
  seen.add(value);
  if(Array.isArray(value))return value.every(item=>isJsonCompatible(item,seen,depth+1));
  if(!isPlainObject(value))return false;
  return Object.values(value).every(item=>isJsonCompatible(item,seen,depth+1));
}

function clone(value){return JSON.parse(JSON.stringify(value));}
function bytesOf(value){return Buffer.byteLength(JSON.stringify(value),'utf8');}

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_VERIFICATION_LIMITS,...overrides};
  for(const key of Object.keys(DEFAULT_VERIFICATION_LIMITS)){
    if(!Number.isInteger(merged[key])||merged[key]<1)throw new TypeError(key+' must be a positive integer');
  }
  if(merged.defaultTimeoutMs>merged.maxTimeoutMs)throw new TypeError('defaultTimeoutMs cannot exceed maxTimeoutMs');
  return Object.freeze(merged);
}

function timeoutError(ms){
  const error=new Error('Verification timed out after '+ms+'ms');
  error.code='NARA_VERIFY_TIMEOUT';
  return error;
}

export class NaraVerificationEngine{
  constructor({
    bus=null,
    now=()=>Date.now(),
    idFactory=()=>randomUUID(),
    limits={}
  }={}){
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.limits=normalizeLimits(limits);
    this.verifiers=new Map();
    this.active=new Map();
    this.history=[];
    this.counters={attempts:0,passed:0,failed:0,errors:0,blocked:0};
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'verification-engine'});
    }
  }

  register({id,handler,timeoutMs=this.limits.defaultTimeoutMs,enabled=true,description=''}={}){
    const verifierId=safeText(id,120);
    if(!SAFE_ID.test(verifierId))throw new TypeError('Invalid verifier id.');
    if(this.verifiers.has(verifierId))throw new Error('Verifier already registered: '+verifierId);
    if(typeof handler!=='function')throw new TypeError('Verifier handler must be a function.');
    const timeout=Number(timeoutMs);
    if(!Number.isInteger(timeout)||timeout<1||timeout>this.limits.maxTimeoutMs){
      throw new TypeError('Verifier timeout is outside the allowed range.');
    }
    this.verifiers.set(verifierId,{
      id:verifierId,
      handler,
      timeoutMs:timeout,
      enabled:Boolean(enabled),
      description:safeText(description,this.limits.maxSummaryLength)
    });
    return this.describe(verifierId);
  }

  describe(id){
    const record=this.verifiers.get(String(id||''));
    if(!record)return null;
    return Object.freeze({
      id:record.id,
      timeoutMs:record.timeoutMs,
      enabled:record.enabled,
      description:record.description
    });
  }

  list(){
    return Object.freeze([...this.verifiers.keys()].sort().map(id=>this.describe(id)));
  }

  setEnabled(id,enabled){
    const verifierId=safeText(id,120);
    const record=this.verifiers.get(verifierId);
    if(!record)throw new Error('Verifier not registered: '+verifierId);
    record.enabled=Boolean(enabled);
    return this.describe(verifierId);
  }

  unregister(id){
    const verifierId=safeText(id,120);
    if([...this.active.values()].some(item=>item.verifierIds.includes(verifierId))){
      throw new Error('Cannot unregister verifier while active: '+verifierId);
    }
    return this.verifiers.delete(verifierId);
  }

  normalizeArtifact(artifact){
    const value=artifact===undefined?null:artifact;
    if(!isJsonCompatible(value))return {ok:false,reason:VERIFICATION_REASONS.INVALID_ARTIFACT};
    const cloned=clone(value);
    if(bytesOf(cloned)>this.limits.maxArtifactBytes){
      return {ok:false,reason:VERIFICATION_REASONS.ARTIFACT_TOO_LARGE};
    }
    return {ok:true,value:cloned};
  }

  normalizeVerifierIds(ids){
    if(!Array.isArray(ids)||ids.length===0)return {ok:false,reason:VERIFICATION_REASONS.NO_CHECKS};
    if(ids.length>this.limits.maxChecks)return {ok:false,reason:VERIFICATION_REASONS.TOO_MANY_CHECKS};
    const result=[];
    for(const raw of ids){
      const id=safeText(raw,120);
      if(!SAFE_ID.test(id))return {ok:false,reason:VERIFICATION_REASONS.VERIFIER_NOT_REGISTERED};
      if(!result.includes(id))result.push(id);
    }
    if(!result.length)return {ok:false,reason:VERIFICATION_REASONS.NO_CHECKS};
    return {ok:true,value:result};
  }

  normalizeCheckResult(raw,verifierId,durationMs){
    if(typeof raw==='boolean'){
      return Object.freeze({
        verifierId,
        ok:raw,
        code:raw?'PASS':'CHECK_FAILED',
        summary:raw?'Verification passed.':'Verification failed.',
        durationMs
      });
    }
    if(!isPlainObject(raw)||typeof raw.ok!=='boolean'){
      throw Object.assign(new Error('Invalid verifier result.'),{code:'NARA_VERIFY_RESULT'});
    }
    const code=safeText(raw.code|| (raw.ok?'PASS':'CHECK_FAILED'),80);
    if(!SAFE_ID.test(code))throw Object.assign(new Error('Invalid verifier result code.'),{code:'NARA_VERIFY_RESULT'});
    return Object.freeze({
      verifierId,
      ok:raw.ok,
      code,
      summary:safeText(raw.summary|| (raw.ok?'Verification passed.':'Verification failed.'),this.limits.maxSummaryLength),
      durationMs
    });
  }

  blocked({verificationId,requestId,executionId,skillId,reason}){
    const at=this.now();
    this.counters.attempts++;
    this.counters.blocked++;
    const report=this.record({
      verificationId,requestId,executionId,skillId,
      verdict:VERIFICATION_VERDICTS.BLOCKED,
      reason,
      startedAt:at,
      endedAt:at,
      durationMs:0,
      checks:[]
    });
    this.emit('verification.blocked',{verificationId,requestId,executionId,skillId,reason});
    return report;
  }

  record(report){
    const frozen=Object.freeze({
      ...report,
      checks:Object.freeze(report.checks.map(check=>Object.freeze({...check})))
    });
    this.history.push(frozen);
    while(this.history.length>this.limits.historyLimit)this.history.shift();
    return frozen;
  }

  async runVerifier(record,artifact,context){
    const controller=new AbortController();
    let timer=null;
    const startedAt=this.now();
    try{
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          reject(timeoutError(record.timeoutMs));
          controller.abort();
        },record.timeoutMs);
      });
      const handlerPromise=Promise.resolve().then(()=>record.handler(
        clone(artifact),
        Object.freeze({...context,signal:controller.signal,verifierId:record.id})
      ));
      const raw=await Promise.race([handlerPromise,timeoutPromise]);
      const endedAt=this.now();
      return this.normalizeCheckResult(raw,record.id,Math.max(0,endedAt-startedAt));
    }catch(error){
      const endedAt=this.now();
      const timedOut=error?.code==='NARA_VERIFY_TIMEOUT';
      return Object.freeze({
        verifierId:record.id,
        ok:false,
        code:timedOut?VERIFICATION_REASONS.CHECK_TIMEOUT:VERIFICATION_REASONS.CHECK_ERROR,
        summary:timedOut?'Verification timed out.':'Verifier returned an error.',
        durationMs:Math.max(0,endedAt-startedAt)
      });
    }finally{
      if(timer!==null)clearTimeout(timer);
    }
  }

  async verify({
    verificationId=null,
    requestId=null,
    execution=null,
    artifact=null,
    verifierIds=[]
  }={}){
    const verifyId=safeText(verificationId||this.idFactory(),120);
    const reqId=safeText(requestId||this.idFactory(),120);
    const executionId=safeText(execution?.executionId||'',120);
    const skillId=safeText(execution?.skillId||'',120);

    if(!execution||typeof execution!=='object'||!executionId||!skillId){
      return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:VERIFICATION_REASONS.EXECUTION_REQUIRED});
    }
    if(execution.status!=='COMPLETED'){
      return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:VERIFICATION_REASONS.EXECUTION_NOT_COMPLETED});
    }

    const normalizedArtifact=this.normalizeArtifact(artifact);
    if(!normalizedArtifact.ok){
      return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:normalizedArtifact.reason});
    }

    const normalizedIds=this.normalizeVerifierIds(verifierIds);
    if(!normalizedIds.ok){
      return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:normalizedIds.reason});
    }

    for(const id of normalizedIds.value){
      const verifier=this.verifiers.get(id);
      if(!verifier){
        return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:VERIFICATION_REASONS.VERIFIER_NOT_REGISTERED});
      }
      if(!verifier.enabled){
        return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:VERIFICATION_REASONS.VERIFIER_DISABLED});
      }
    }

    if(this.active.size>=this.limits.maxConcurrent){
      return this.blocked({verificationId:verifyId,requestId:reqId,executionId,skillId,reason:VERIFICATION_REASONS.CONCURRENCY_LIMIT});
    }

    this.counters.attempts++;
    const startedAt=this.now();
    this.active.set(verifyId,{
      verificationId:verifyId,
      executionId,
      skillId,
      verifierIds:[...normalizedIds.value],
      startedAt
    });
    this.emit('verification.start',{
      verificationId:verifyId,
      requestId:reqId,
      executionId,
      skillId,
      verifierCount:normalizedIds.value.length
    });

    try{
      const checks=[];
      for(const id of normalizedIds.value){
        const verifier=this.verifiers.get(id);
        checks.push(await this.runVerifier(verifier,normalizedArtifact.value,{
          verificationId:verifyId,
          requestId:reqId,
          executionId,
          skillId
        }));
      }

      const hasError=checks.some(check=>
        check.code===VERIFICATION_REASONS.CHECK_ERROR||
        check.code===VERIFICATION_REASONS.CHECK_TIMEOUT
      );
      const hasFailure=checks.some(check=>!check.ok);
      const verdict=hasError
        ?VERIFICATION_VERDICTS.ERROR
        :hasFailure
          ?VERIFICATION_VERDICTS.FAIL
          :VERIFICATION_VERDICTS.PASS;
      const reason=hasError
        ?(checks.some(check=>check.code===VERIFICATION_REASONS.CHECK_TIMEOUT)
          ?VERIFICATION_REASONS.CHECK_TIMEOUT
          :VERIFICATION_REASONS.CHECK_ERROR)
        :hasFailure
          ?VERIFICATION_REASONS.CHECK_FAILED
          :null;
      const endedAt=this.now();
      const report=this.record({
        verificationId:verifyId,
        requestId:reqId,
        executionId,
        skillId,
        verdict,
        reason,
        startedAt,
        endedAt,
        durationMs:Math.max(0,endedAt-startedAt),
        checks
      });

      if(verdict===VERIFICATION_VERDICTS.PASS)this.counters.passed++;
      else if(verdict===VERIFICATION_VERDICTS.FAIL)this.counters.failed++;
      else this.counters.errors++;

      this.emit('verification.complete',{
        verificationId:verifyId,
        requestId:reqId,
        executionId,
        skillId,
        verdict,
        reason,
        checkCount:checks.length,
        failedChecks:checks.filter(check=>!check.ok).length,
        durationMs:report.durationMs
      });
      return report;
    }finally{
      this.active.delete(verifyId);
    }
  }

  toLearningSignal(report,{id=null,weight=1,tags=['verification']}={}){
    if(!report||typeof report!=='object')return null;
    if(![VERIFICATION_VERDICTS.PASS,VERIFICATION_VERDICTS.FAIL].includes(report.verdict))return null;
    return Object.freeze({
      id:id||('verify-'+report.verificationId),
      kind:'verification',
      skillId:report.skillId,
      outcome:report.verdict===VERIFICATION_VERDICTS.PASS?'success':'failure',
      latencyMs:report.durationMs,
      authority:'verifier',
      timestamp:report.endedAt,
      weight,
      tags:Object.freeze([...tags])
    });
  }

  recent({limit=25,verdict=null}={}){
    const max=Math.max(1,Math.min(this.limits.historyLimit,Number(limit)||25));
    const source=verdict?this.history.filter(item=>item.verdict===verdict):this.history;
    return Object.freeze(source.slice(-max).map(item=>Object.freeze({
      ...item,
      checks:Object.freeze(item.checks.map(check=>Object.freeze({...check})))
    })));
  }

  snapshot(){
    return Object.freeze({
      version:VERIFICATION_ENGINE_VERSION,
      registered:this.verifiers.size,
      active:this.active.size,
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      verifiers:this.list(),
      recent:this.recent({limit:Math.min(10,this.limits.historyLimit)})
    });
  }
}

export function createVerificationEngine(options){
  return new NaraVerificationEngine(options);
}
