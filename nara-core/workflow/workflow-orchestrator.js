import {randomUUID} from 'node:crypto';
import {
  WORKFLOW_ORCHESTRATOR_VERSION,
  WORKFLOW_STATUS,
  WORKFLOW_REASONS,
  DEFAULT_WORKFLOW_LIMITS
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function normalizeLimits(overrides={}){
  const merged={...DEFAULT_WORKFLOW_LIMITS,...overrides};
  for(const key of Object.keys(DEFAULT_WORKFLOW_LIMITS)){
    if(!Number.isInteger(merged[key])||merged[key]<1)throw new TypeError(key+' must be a positive integer');
  }
  return Object.freeze(merged);
}

function requireMethod(component,name,label){
  if(!component||typeof component[name]!=='function'){
    throw new TypeError(label+' must expose '+name+'()');
  }
}

function freezeClone(value){
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function summarizeDecision(decision){
  if(!decision||typeof decision!=='object')return null;
  const reasonCodes=Array.isArray(decision.reasonCodes)
    ?decision.reasonCodes.slice(0,16).map(code=>safeText(code,80)).filter(code=>SAFE_ID.test(code))
    :[];
  return Object.freeze({
    id:safeText(decision.id??'',120)||null,
    outcome:safeText(decision.outcome??'',40)||null,
    risk:safeText(decision.risk??'',40)||null,
    capability:safeText(decision.capability??'',120)||null,
    reasonCodes:Object.freeze(reasonCodes)
  });
}

function summarizeContext(context){
  if(!context||typeof context!=='object')return null;
  return Object.freeze({
    id:context.id??null,
    target:context.target??null,
    itemCount:Array.isArray(context.items)?context.items.length:(context.itemCount??0),
    totalBytes:context.totalBytes??0,
    sensitiveBlocked:context.sensitiveBlocked??0
  });
}

function summarizeExecution(execution){
  if(!execution||typeof execution!=='object')return null;
  return Object.freeze({
    executionId:execution.executionId??null,
    skillId:execution.skillId??null,
    status:execution.status??null,
    reason:execution.reason??null,
    durationMs:execution.durationMs??0
  });
}

function summarizeVerification(report){
  if(!report||typeof report!=='object')return null;
  return Object.freeze({
    verificationId:report.verificationId??null,
    verdict:report.verdict??null,
    reason:report.reason??null,
    durationMs:report.durationMs??0,
    checkCount:Array.isArray(report.checks)?report.checks.length:0,
    failedChecks:Array.isArray(report.checks)?report.checks.filter(check=>!check.ok).length:0
  });
}

export class NaraWorkflowOrchestrator{
  constructor({
    decisionEngine,
    memoryManager,
    skillExecutor,
    verificationEngine,
    learningEngine,
    bus=null,
    now=()=>Date.now(),
    idFactory=()=>randomUUID(),
    limits={}
  }={}){
    requireMethod(decisionEngine,'decide','decisionEngine');
    requireMethod(memoryManager,'prepareContext','memoryManager');
    requireMethod(memoryManager,'useContext','memoryManager');
    requireMethod(skillExecutor,'execute','skillExecutor');
    requireMethod(verificationEngine,'verify','verificationEngine');
    requireMethod(verificationEngine,'toLearningSignal','verificationEngine');
    requireMethod(learningEngine,'observeExecution','learningEngine');
    requireMethod(learningEngine,'ingest','learningEngine');

    this.decisionEngine=decisionEngine;
    this.memoryManager=memoryManager;
    this.skillExecutor=skillExecutor;
    this.verificationEngine=verificationEngine;
    this.learningEngine=learningEngine;
    this.bus=bus;
    this.now=now;
    this.idFactory=idFactory;
    this.limits=normalizeLimits(limits);
    this.active=new Map();
    this.history=[];
    this.byId=new Map();
    this.counters={
      attempts:0,
      completed:0,
      blocked:0,
      deferred:0,
      approvalRequired:0,
      executionFailed:0,
      verificationFailed:0,
      verificationError:0,
      internalError:0
    };
  }

  emit(event,payload={}){
    if(this.bus&&typeof this.bus.emit==='function'){
      this.bus.emit(event,payload,{source:'workflow-orchestrator'});
    }
  }

  finalize(base,status,reason,parts={}){
    const endedAt=this.now();
    const record=Object.freeze({
      version:WORKFLOW_ORCHESTRATOR_VERSION,
      workflowId:base.workflowId,
      requestId:base.requestId,
      skillId:base.skillId,
      status,
      reason,
      startedAt:base.startedAt,
      endedAt,
      durationMs:Math.max(0,endedAt-base.startedAt),
      decision:parts.decision??null,
      context:parts.context??null,
      execution:parts.execution??null,
      verification:parts.verification??null,
      learning:Object.freeze({
        executionRecorded:Boolean(parts.learning?.executionRecorded),
        verificationRecorded:Boolean(parts.learning?.verificationRecorded)
      })
    });
    this.history.push(record);
    this.byId.set(record.workflowId,record);
    while(this.history.length>this.limits.historyLimit){
      const removed=this.history.shift();
      if(removed&&this.byId.get(removed.workflowId)===removed)this.byId.delete(removed.workflowId);
    }

    if(status===WORKFLOW_STATUS.COMPLETED)this.counters.completed++;
    else if(status===WORKFLOW_STATUS.BLOCKED)this.counters.blocked++;
    else if(status===WORKFLOW_STATUS.DEFERRED)this.counters.deferred++;
    else if(status===WORKFLOW_STATUS.APPROVAL_REQUIRED)this.counters.approvalRequired++;
    else if(status===WORKFLOW_STATUS.EXECUTION_FAILED)this.counters.executionFailed++;
    else if(status===WORKFLOW_STATUS.VERIFICATION_FAILED)this.counters.verificationFailed++;
    else if(status===WORKFLOW_STATUS.VERIFICATION_ERROR)this.counters.verificationError++;
    else if(status===WORKFLOW_STATUS.INTERNAL_ERROR)this.counters.internalError++;

    this.emit('workflow.complete',{
      workflowId:record.workflowId,
      requestId:record.requestId,
      skillId:record.skillId,
      status:record.status,
      reason:record.reason,
      durationMs:record.durationMs
    });
    return record;
  }

  async run({
    workflowId=null,
    requestId=null,
    decisionRequest,
    decisionContext={},
    contextRequest=null,
    skillId,
    input={},
    verifierIds=[]
  }={}){
    const wfId=safeText(workflowId||this.idFactory(),120);
    const reqId=safeText(requestId||this.idFactory(),120);
    const normalizedSkillId=safeText(skillId,120);
    if(!SAFE_ID.test(wfId)||!SAFE_ID.test(reqId)||!SAFE_ID.test(normalizedSkillId)){
      throw new TypeError('Invalid workflow/request/skill id.');
    }

    if(this.byId.has(wfId)){
      return Object.freeze({...this.byId.get(wfId),duplicate:true});
    }
    if(this.active.has(wfId)){
      const at=this.now();
      return Object.freeze({
        version:WORKFLOW_ORCHESTRATOR_VERSION,
        workflowId:wfId,
        requestId:reqId,
        skillId:normalizedSkillId,
        status:WORKFLOW_STATUS.BLOCKED,
        reason:WORKFLOW_REASONS.DUPLICATE_WORKFLOW,
        startedAt:at,
        endedAt:at,
        durationMs:0,
        decision:null,
        context:null,
        execution:null,
        verification:null,
        learning:Object.freeze({executionRecorded:false,verificationRecorded:false}),
        duplicate:true
      });
    }
    if(this.active.size>=this.limits.maxConcurrent){
      const base={workflowId:wfId,requestId:reqId,skillId:normalizedSkillId,startedAt:this.now()};
      this.counters.attempts++;
      return this.finalize(base,WORKFLOW_STATUS.DEFERRED,WORKFLOW_REASONS.CONCURRENCY_LIMIT);
    }
    if(contextRequest?.includeSensitive===true){
      const base={workflowId:wfId,requestId:reqId,skillId:normalizedSkillId,startedAt:this.now()};
      this.counters.attempts++;
      return this.finalize(
        base,
        WORKFLOW_STATUS.BLOCKED,
        WORKFLOW_REASONS.SENSITIVE_CONTEXT_REQUIRES_SEPARATE_APPROVAL_FLOW
      );
    }

    this.counters.attempts++;
    const base={workflowId:wfId,requestId:reqId,skillId:normalizedSkillId,startedAt:this.now()};
    this.active.set(wfId,{...base});
    this.emit('workflow.start',{workflowId:wfId,requestId:reqId,skillId:normalizedSkillId});

    let decisionSummary=null;
    let contextSummary=null;
    let executionSummary=null;
    let verificationSummary=null;
    const learning={executionRecorded:false,verificationRecorded:false};

    try{
      const decision=this.decisionEngine.decide(
        {...decisionRequest,id:decisionRequest?.id||('decision-'+wfId)},
        decisionContext
      );
      decisionSummary=summarizeDecision(decision);

      if(!decision||typeof decision!=='object'||!decision.outcome){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.DECISION_INVALID,{decision:decisionSummary});
      }
      if(decision.outcome==='BLOCK'){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.DECISION_BLOCKED,{decision:decisionSummary});
      }
      if(decision.outcome==='DEFER'){
        return this.finalize(base,WORKFLOW_STATUS.DEFERRED,WORKFLOW_REASONS.DECISION_DEFERRED,{decision:decisionSummary});
      }
      if(decision.outcome==='REQUIRE_APPROVAL'){
        return this.finalize(base,WORKFLOW_STATUS.APPROVAL_REQUIRED,WORKFLOW_REASONS.DECISION_APPROVAL_REQUIRED,{decision:decisionSummary});
      }
      if(decision.outcome!=='ALLOW'){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.DECISION_INVALID,{decision:decisionSummary});
      }
      if(decision.capability!==normalizedSkillId){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.DECISION_CAPABILITY_MISMATCH,{decision:decisionSummary});
      }

      let preparedContext=null;
      if(contextRequest){
        preparedContext=this.memoryManager.prepareContext({
          ...contextRequest,
          includeSensitive:false
        });
        contextSummary=summarizeContext(preparedContext);
        this.memoryManager.useContext(preparedContext.id);
      }

      const executionInput=preparedContext
        ?{request:input,context:{id:preparedContext.id,items:preparedContext.items}}
        :{request:input,context:null};

      const execution=await this.skillExecutor.execute({
        skillId:normalizedSkillId,
        input:executionInput,
        decision,
        requestId:reqId
      });
      executionSummary=summarizeExecution(execution);

      try{
        this.learningEngine.observeExecution({
          learningSignalId:'execution-'+wfId,
          executionId:execution?.executionId??null,
          skillId:execution?.skillId??normalizedSkillId,
          status:execution?.status??null,
          durationMs:execution?.durationMs??0,
          endedAt:execution?.endedAt??this.now()
        },{authority:'system',tags:['workflow']});
        learning.executionRecorded=true;
      }catch{
        learning.executionRecorded=false;
      }

      if(execution?.status==='BLOCKED'){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.EXECUTION_BLOCKED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,learning
        });
      }
      if(execution?.status==='DEFERRED'){
        return this.finalize(base,WORKFLOW_STATUS.DEFERRED,WORKFLOW_REASONS.EXECUTION_DEFERRED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,learning
        });
      }
      if(execution?.status!=='COMPLETED'){
        return this.finalize(base,WORKFLOW_STATUS.EXECUTION_FAILED,WORKFLOW_REASONS.EXECUTION_FAILED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,learning
        });
      }

      if(!Array.isArray(verifierIds)||verifierIds.length===0){
        return this.finalize(base,WORKFLOW_STATUS.VERIFICATION_ERROR,WORKFLOW_REASONS.VERIFICATION_REQUIRED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,learning
        });
      }

      const report=await this.verificationEngine.verify({
        verificationId:'verification-'+wfId,
        requestId:reqId,
        execution:{
          executionId:execution.executionId,
          skillId:execution.skillId,
          status:execution.status
        },
        artifact:execution.output,
        verifierIds
      });
      verificationSummary=summarizeVerification(report);

      const learningSignal=this.verificationEngine.toLearningSignal(report);
      if(learningSignal){
        try{
          this.learningEngine.ingest(learningSignal);
          learning.verificationRecorded=true;
        }catch{
          learning.verificationRecorded=false;
        }
      }

      if(report?.verdict==='PASS'){
        return this.finalize(base,WORKFLOW_STATUS.COMPLETED,null,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,
          verification:verificationSummary,learning
        });
      }
      if(report?.verdict==='FAIL'){
        return this.finalize(base,WORKFLOW_STATUS.VERIFICATION_FAILED,WORKFLOW_REASONS.VERIFICATION_FAILED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,
          verification:verificationSummary,learning
        });
      }
      if(report?.verdict==='BLOCKED'){
        return this.finalize(base,WORKFLOW_STATUS.BLOCKED,WORKFLOW_REASONS.VERIFICATION_BLOCKED,{
          decision:decisionSummary,context:contextSummary,execution:executionSummary,
          verification:verificationSummary,learning
        });
      }
      return this.finalize(base,WORKFLOW_STATUS.VERIFICATION_ERROR,WORKFLOW_REASONS.VERIFICATION_ERROR,{
        decision:decisionSummary,context:contextSummary,execution:executionSummary,
        verification:verificationSummary,learning
      });
    }catch{
      return this.finalize(base,WORKFLOW_STATUS.INTERNAL_ERROR,WORKFLOW_REASONS.COMPONENT_ERROR,{
        decision:decisionSummary,context:contextSummary,execution:executionSummary,
        verification:verificationSummary,learning
      });
    }finally{
      this.active.delete(wfId);
    }
  }

  get(workflowId){
    const record=this.byId.get(String(workflowId||''));
    return record?freezeClone(record):null;
  }

  recent({limit=25,status=null}={}){
    const max=Math.max(1,Math.min(this.limits.historyLimit,Number(limit)||25));
    const source=status?this.history.filter(item=>item.status===status):this.history;
    return Object.freeze(source.slice(-max).map(freezeClone));
  }

  snapshot(){
    return Object.freeze({
      version:WORKFLOW_ORCHESTRATOR_VERSION,
      active:this.active.size,
      counters:Object.freeze({...this.counters}),
      limits:this.limits,
      recent:this.recent({limit:Math.min(10,this.limits.historyLimit)})
    });
  }
}

export function createWorkflowOrchestrator(options){
  return new NaraWorkflowOrchestrator(options);
}
