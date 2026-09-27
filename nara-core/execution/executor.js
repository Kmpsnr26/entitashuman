import {randomUUID} from 'node:crypto';
import {
  SKILL_EXECUTOR_VERSION,
  SKILL_EXECUTION_STATUS,
  SKILL_EXECUTION_REASON,
  DEFAULT_SKILL_EXECUTOR_LIMITS
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

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function bytesOf(value){
  return Buffer.byteLength(JSON.stringify(value),'utf8');
}

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_SKILL_EXECUTOR_LIMITS,...overrides};
  for(const key of Object.keys(DEFAULT_SKILL_EXECUTOR_LIMITS)){
    if(!Number.isInteger(merged[key])||merged[key]<1){
      throw new TypeError(key+' must be a positive integer');
    }
  }
  if(merged.defaultTimeoutMs>merged.maxTimeoutMs){
    throw new TypeError('defaultTimeoutMs cannot exceed maxTimeoutMs');
  }
  return Object.freeze(merged);
}

function timeoutError(ms){
  const error=new Error('Skill execution timed out after '+ms+'ms');
  error.code='NARA_SKILL_TIMEOUT';
  return error;
}

export class NaraSkillExecutor{
  constructor({
    registry=null,
    bus=null,
    now=()=>Date.now(),
    idFactory=()=>randomUUID(),
    limits={}
  }={}){
    this.registry=registry;
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.limits=normalizeLimits(limits);
    this.handlers=new Map();
    this.active=new Map();
    this.history=[];
    this.counters={
      attempts:0,
      completed:0,
      failed:0,
      blocked:0,
      deferred:0,
      timedOut:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'skill-executor'});
    }
  }

  register({id,handler,timeoutMs=this.limits.defaultTimeoutMs,enabled=true,description=''}={}){
    const skillId=safeText(id,120);
    if(!SAFE_ID.test(skillId))throw new TypeError('Invalid skill id.');
    if(this.handlers.has(skillId))throw new Error('Skill handler already registered: '+skillId);
    if(typeof handler!=='function')throw new TypeError('Skill handler must be a function.');
    const timeout=Number(timeoutMs);
    if(!Number.isInteger(timeout)||timeout<1||timeout>this.limits.maxTimeoutMs){
      throw new TypeError('Skill timeout is outside the allowed range.');
    }
    const record={
      id:skillId,
      handler,
      timeoutMs:timeout,
      enabled:Boolean(enabled),
      description:safeText(description,160)
    };
    this.handlers.set(skillId,record);
    return this.describe(skillId);
  }

  unregister(id){
    const skillId=safeText(id,120);
    if(this.active.has(skillId))throw new Error('Cannot unregister an active skill: '+skillId);
    return this.handlers.delete(skillId);
  }

  setEnabled(id,enabled){
    const skillId=safeText(id,120);
    const record=this.handlers.get(skillId);
    if(!record)throw new Error('Skill handler not registered: '+skillId);
    record.enabled=Boolean(enabled);
    return this.describe(skillId);
  }

  describe(id){
    const record=this.handlers.get(String(id||''));
    if(!record)return null;
    return Object.freeze({
      id:record.id,
      timeoutMs:record.timeoutMs,
      enabled:record.enabled,
      description:record.description,
      active:this.active.has(record.id)
    });
  }

  list(){
    return Object.freeze([...this.handlers.keys()].sort().map(id=>this.describe(id)));
  }

  blocked({executionId,requestId,skillId,reason,decisionId=null}){
    this.counters.attempts++;
    this.counters.blocked++;
    const record=this.recordHistory({
      executionId,
      requestId,
      skillId,
      decisionId,
      status:SKILL_EXECUTION_STATUS.BLOCKED,
      reason,
      startedAt:this.now(),
      endedAt:this.now(),
      durationMs:0
    });
    this.emit('skill.execution.blocked',{
      executionId,
      requestId,
      skillId,
      decisionId,
      reason
    });
    return Object.freeze({...record,output:null});
  }

  deferred({executionId,requestId,skillId,reason,decisionId=null}){
    this.counters.attempts++;
    this.counters.deferred++;
    const at=this.now();
    const record=this.recordHistory({
      executionId,
      requestId,
      skillId,
      decisionId,
      status:SKILL_EXECUTION_STATUS.DEFERRED,
      reason,
      startedAt:at,
      endedAt:at,
      durationMs:0
    });
    this.emit('skill.execution.deferred',{
      executionId,
      requestId,
      skillId,
      decisionId,
      reason
    });
    return Object.freeze({...record,output:null});
  }

  validateAuthorization(skillId,decision){
    if(!decision||typeof decision!=='object'){
      return SKILL_EXECUTION_REASON.DECISION_REQUIRED;
    }
    if(decision.outcome!=='ALLOW'){
      return SKILL_EXECUTION_REASON.DECISION_NOT_ALLOWED;
    }
    if(decision.capability!==skillId){
      return SKILL_EXECUTION_REASON.CAPABILITY_MISMATCH;
    }
    return null;
  }

  validateRegistry(skillId){
    if(!this.registry)return null;
    if(typeof this.registry.get!=='function')return SKILL_EXECUTION_REASON.REGISTRY_SKILL_UNAVAILABLE;
    const skill=this.registry.get(skillId);
    if(!skill||skill.enabled!==true)return SKILL_EXECUTION_REASON.REGISTRY_SKILL_UNAVAILABLE;
    return null;
  }

  normalizeInput(input){
    const value=input===undefined?{}:input;
    if(!isJsonCompatible(value)){
      return {ok:false,reason:SKILL_EXECUTION_REASON.INVALID_INPUT};
    }
    const cloned=clone(value);
    if(bytesOf(cloned)>this.limits.maxInputBytes){
      return {ok:false,reason:SKILL_EXECUTION_REASON.INPUT_TOO_LARGE};
    }
    return {ok:true,value:cloned};
  }

  normalizeOutput(output){
    const value=output===undefined?null:output;
    if(!isJsonCompatible(value)){
      return {ok:false,reason:SKILL_EXECUTION_REASON.INVALID_OUTPUT};
    }
    const cloned=clone(value);
    if(bytesOf(cloned)>this.limits.maxOutputBytes){
      return {ok:false,reason:SKILL_EXECUTION_REASON.OUTPUT_TOO_LARGE};
    }
    return {ok:true,value:cloned};
  }

  recordHistory(record){
    const frozen=Object.freeze({...record});
    this.history.push(frozen);
    while(this.history.length>this.limits.historyLimit)this.history.shift();
    return frozen;
  }

  async execute({skillId,input={},decision=null,requestId=null}={}){
    const id=safeText(skillId,120);
    const reqId=safeText(requestId||this.idFactory(),120);
    const executionId='exec-'+safeText(this.idFactory(),110);
    const decisionId=safeText(decision?.id||'',120)||null;

    if(!SAFE_ID.test(id)){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:SKILL_EXECUTION_REASON.SKILL_NOT_REGISTERED
      });
    }

    const authorizationError=this.validateAuthorization(id,decision);
    if(authorizationError){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:authorizationError
      });
    }

    const handlerRecord=this.handlers.get(id);
    if(!handlerRecord){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:SKILL_EXECUTION_REASON.SKILL_NOT_REGISTERED
      });
    }
    if(!handlerRecord.enabled){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:SKILL_EXECUTION_REASON.SKILL_DISABLED
      });
    }

    const registryError=this.validateRegistry(id);
    if(registryError){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:registryError
      });
    }

    const normalizedInput=this.normalizeInput(input);
    if(!normalizedInput.ok){
      return this.blocked({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:normalizedInput.reason
      });
    }

    if(this.active.size>=this.limits.maxConcurrent){
      return this.deferred({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason:SKILL_EXECUTION_REASON.CONCURRENCY_LIMIT
      });
    }

    this.counters.attempts++;
    const startedAt=this.now();
    const controller=new AbortController();
    const activeRecord={executionId,requestId:reqId,skillId:id,decisionId,startedAt,controller};
    this.active.set(executionId,activeRecord);

    this.registry?.start?.(id,{
      timestamp:startedAt,
      label:'Skill execution',
      event:'skill.execution.start'
    });
    this.emit('skill.execution.start',{
      executionId,
      requestId:reqId,
      skillId:id,
      decisionId,
      timeoutMs:handlerRecord.timeoutMs
    });

    let timer=null;
    try{
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          controller.abort();
          reject(timeoutError(handlerRecord.timeoutMs));
        },handlerRecord.timeoutMs);
      });

      const handlerPromise=Promise.resolve().then(()=>handlerRecord.handler(
        normalizedInput.value,
        Object.freeze({
          signal:controller.signal,
          executionId,
          requestId:reqId,
          decisionId,
          skillId:id
        })
      ));

      const rawOutput=await Promise.race([handlerPromise,timeoutPromise]);
      const normalizedOutput=this.normalizeOutput(rawOutput);
      if(!normalizedOutput.ok){
        throw Object.assign(new Error(normalizedOutput.reason),{code:normalizedOutput.reason});
      }

      const endedAt=this.now();
      const record=this.recordHistory({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        status:SKILL_EXECUTION_STATUS.COMPLETED,
        reason:null,
        startedAt,
        endedAt,
        durationMs:Math.max(0,endedAt-startedAt)
      });
      this.counters.completed++;
      this.registry?.finish?.(id,{
        timestamp:endedAt,
        ok:true,
        label:'Skill execution',
        event:'skill.execution.complete'
      });
      this.emit('skill.execution.complete',{
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        durationMs:record.durationMs
      });
      return Object.freeze({...record,output:normalizedOutput.value});
    }catch(error){
      const endedAt=this.now();
      const timedOut=error?.code==='NARA_SKILL_TIMEOUT';
      const outputError=[
        SKILL_EXECUTION_REASON.INVALID_OUTPUT,
        SKILL_EXECUTION_REASON.OUTPUT_TOO_LARGE
      ].includes(error?.code);
      const reason=timedOut
        ?SKILL_EXECUTION_REASON.EXECUTION_TIMEOUT
        :outputError
          ?error.code
          :SKILL_EXECUTION_REASON.HANDLER_ERROR;
      const status=timedOut?SKILL_EXECUTION_STATUS.TIMEOUT:SKILL_EXECUTION_STATUS.FAILED;
      const record=this.recordHistory({
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        status,
        reason,
        startedAt,
        endedAt,
        durationMs:Math.max(0,endedAt-startedAt)
      });
      if(timedOut)this.counters.timedOut++;else this.counters.failed++;
      this.registry?.finish?.(id,{
        timestamp:endedAt,
        ok:false,
        label:'Skill execution',
        event:timedOut?'skill.execution.timeout':'skill.execution.failed'
      });
      this.emit(timedOut?'skill.execution.timeout':'skill.execution.failed',{
        executionId,
        requestId:reqId,
        skillId:id,
        decisionId,
        reason,
        durationMs:record.durationMs,
        errorName:safeText(error?.name||'Error',80)
      });
      return Object.freeze({...record,output:null});
    }finally{
      if(timer!==null)clearTimeout(timer);
      this.active.delete(executionId);
    }
  }

  recent({limit=25,status=null}={}){
    const max=Math.max(1,Math.min(this.limits.historyLimit,Number(limit)||25));
    const source=status?this.history.filter(item=>item.status===status):this.history;
    return Object.freeze(source.slice(-max).map(item=>Object.freeze({...item})));
  }

  snapshot(){
    return Object.freeze({
      version:SKILL_EXECUTOR_VERSION,
      registered:this.handlers.size,
      active:this.active.size,
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      handlers:this.list(),
      recent:this.recent({limit:Math.min(10,this.limits.historyLimit)})
    });
  }
}

export function createSkillExecutor(options){
  return new NaraSkillExecutor(options);
}
