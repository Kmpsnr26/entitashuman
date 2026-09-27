import {randomUUID} from 'node:crypto';
import {
  DECISION_ENGINE_VERSION,
  DECISION_POLICY_VERSION,
  DECISION_OUTCOMES,
  DECISION_REASON_CODES
} from './constants.js';
import {
  createDecisionPolicy,
  normalizeDecisionRequest,
  evaluateDecisionRequest
} from './policy.js';

const EVENT_BY_OUTCOME=Object.freeze({
  [DECISION_OUTCOMES.ALLOW]:'decision.allowed',
  [DECISION_OUTCOMES.REQUIRE_APPROVAL]:'decision.approval_required',
  [DECISION_OUTCOMES.DEFER]:'decision.deferred',
  [DECISION_OUTCOMES.BLOCK]:'decision.blocked'
});

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function safeInvalidDecision({id,action,actor,error,now}){
  return Object.freeze({
    engineVersion:DECISION_ENGINE_VERSION,
    policyVersion:DECISION_POLICY_VERSION,
    id,
    action,
    actor,
    target:'',
    label:action||'invalid-request',
    requestedAt:now,
    decidedAt:now,
    outcome:DECISION_OUTCOMES.BLOCK,
    risk:'critical',
    reasonCodes:Object.freeze([DECISION_REASON_CODES.INVALID_REQUEST]),
    summary:'Decision request validation failed.',
    missingApprovals:Object.freeze([]),
    missingDependencies:Object.freeze([]),
    missingGates:Object.freeze([]),
    capability:null,
    confidence:1,
    validationError:String(error?.message||error||'invalid request').slice(0,240)
  });
}

export class NaraDecisionEngine{
  constructor({
    policy=createDecisionPolicy(),
    bus=null,
    now=()=>Date.now(),
    idFactory=()=>randomUUID(),
    historyLimit=100
  }={}){
    if(!Number.isInteger(historyLimit)||historyLimit<1||historyLimit>2000){
      throw new TypeError('historyLimit must be an integer between 1 and 2000');
    }
    this.policy=policy;
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.historyLimit=historyLimit;
    this.history=[];
    this.byId=new Map();
    this.counters={
      total:0,
      allowed:0,
      approvalRequired:0,
      deferred:0,
      blocked:0,
      duplicates:0,
      invalid:0
    };
  }

  decide(rawRequest,context={}){
    const fallbackId=String(rawRequest?.id||this.idFactory());
    if(this.byId.has(fallbackId)){
      this.counters.duplicates++;
      return Object.freeze({...clone(this.byId.get(fallbackId)),duplicate:true});
    }

    let request;
    let record;
    const decidedAt=this.now();

    try{
      request=normalizeDecisionRequest(
        {...rawRequest,id:rawRequest?.id||fallbackId},
        {idFactory:this.idFactory}
      );
      const evaluated=evaluateDecisionRequest(request,context,{policy:this.policy});
      record=Object.freeze({
        engineVersion:DECISION_ENGINE_VERSION,
        policyVersion:DECISION_POLICY_VERSION,
        ...request,
        requestedAt:request.requestedAt??decidedAt,
        decidedAt,
        outcome:evaluated.outcome,
        risk:evaluated.risk,
        reasonCodes:Object.freeze([...evaluated.reasonCodes]),
        summary:evaluated.summary,
        missingApprovals:Object.freeze([...evaluated.missingApprovals]),
        missingDependencies:Object.freeze([...evaluated.missingDependencies]),
        missingGates:Object.freeze([...evaluated.missingGates]),
        capability:evaluated.capability,
        confidence:evaluated.confidence
      });
    }catch(error){
      this.counters.invalid++;
      record=safeInvalidDecision({
        id:fallbackId,
        action:String(rawRequest?.action||'').slice(0,120),
        actor:String(rawRequest?.actor||'system').slice(0,80),
        error,
        now:decidedAt
      });
    }

    this.record(record);
    return Object.freeze(clone(record));
  }

  record(record){
    this.history.push(record);
    this.byId.set(record.id,record);
    while(this.history.length>this.historyLimit){
      const removed=this.history.shift();
      if(removed&&this.byId.get(removed.id)===removed)this.byId.delete(removed.id);
    }

    this.counters.total++;
    if(record.outcome===DECISION_OUTCOMES.ALLOW)this.counters.allowed++;
    else if(record.outcome===DECISION_OUTCOMES.REQUIRE_APPROVAL)this.counters.approvalRequired++;
    else if(record.outcome===DECISION_OUTCOMES.DEFER)this.counters.deferred++;
    else if(record.outcome===DECISION_OUTCOMES.BLOCK)this.counters.blocked++;

    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit('decision.completed',{
        id:record.id,
        action:record.action,
        outcome:record.outcome,
        risk:record.risk,
        reasonCodes:[...record.reasonCodes]
      },{source:'decision-engine'});
      const outcomeEvent=EVENT_BY_OUTCOME[record.outcome];
      if(outcomeEvent){
        this.bus.emit(outcomeEvent,{
          id:record.id,
          action:record.action,
          risk:record.risk,
          reasonCodes:[...record.reasonCodes]
        },{source:'decision-engine'});
      }
    }
  }

  get(id){
    const record=this.byId.get(String(id||''));
    return record?Object.freeze(clone(record)):null;
  }

  recent({limit=25,outcome=null}={}){
    const max=Math.max(1,Math.min(this.historyLimit,Number(limit)||25));
    const source=outcome?this.history.filter(item=>item.outcome===outcome):this.history;
    return Object.freeze(source.slice(-max).map(item=>Object.freeze(clone(item))));
  }

  snapshot(){
    return Object.freeze({
      version:DECISION_ENGINE_VERSION,
      policyVersion:DECISION_POLICY_VERSION,
      policyActions:Object.freeze(Object.keys(this.policy)),
      historySize:this.history.length,
      historyLimit:this.historyLimit,
      counters:Object.freeze({...this.counters}),
      lastDecision:this.history.length?Object.freeze(clone(this.history.at(-1))):null
    });
  }
}

export function createDecisionEngine(options){
  return new NaraDecisionEngine(options);
}
