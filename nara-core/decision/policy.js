import {
  DECISION_OUTCOMES,
  DECISION_REASON_CODES,
  DEFAULT_ACTION_POLICIES
} from './constants.js';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const READY_DEPENDENCY_STATES=new Set(['ready','connected','available','active','healthy']);
const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

function normalizeStringList(value,{maxItems=32,maxLength=120}={}){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value))throw new TypeError('Expected an array.');
  if(value.length>maxItems)throw new TypeError('Too many list items.');
  const out=[];
  for(const item of value){
    const normalized=safeText(item,maxLength);
    if(!normalized||!SAFE_ID.test(normalized))throw new TypeError('Invalid identifier: '+normalized);
    if(!out.includes(normalized))out.push(normalized);
  }
  return out;
}

function clonePolicyEntry(entry){
  return {
    enabled:entry.enabled!==false,
    risk:entry.risk||'low',
    capability:entry.capability??null,
    requiredApprovals:[...(entry.requiredApprovals||[])],
    requiredGates:[...(entry.requiredGates||[])],
    defaultDependencies:[...(entry.defaultDependencies||[])]
  };
}

export function createDecisionPolicy({actions={}}={}){
  const merged={};
  for(const [action,entry] of Object.entries(DEFAULT_ACTION_POLICIES)){
    merged[action]=clonePolicyEntry(entry);
  }
  for(const [action,override] of Object.entries(actions||{})){
    const name=safeText(action,120);
    if(!SAFE_ID.test(name))throw new TypeError('Invalid action policy id: '+name);
    const base=merged[name]||{
      enabled:true,
      risk:'low',
      capability:null,
      requiredApprovals:[],
      requiredGates:[],
      defaultDependencies:[]
    };
    merged[name]={
      ...base,
      ...override,
      requiredApprovals:[...(override?.requiredApprovals??base.requiredApprovals)],
      requiredGates:[...(override?.requiredGates??base.requiredGates)],
      defaultDependencies:[...(override?.defaultDependencies??base.defaultDependencies)]
    };
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(merged).map(([action,entry])=>[action,Object.freeze({
      ...entry,
      requiredApprovals:Object.freeze([...entry.requiredApprovals]),
      requiredGates:Object.freeze([...entry.requiredGates]),
      defaultDependencies:Object.freeze([...entry.defaultDependencies])
    })])
  ));
}

export function normalizeDecisionRequest(request,{idFactory}={}){
  if(request===null||typeof request!=='object'||Array.isArray(request)){
    throw new TypeError('Decision request must be an object.');
  }

  const action=safeText(request.action,120);
  if(!action||!SAFE_ID.test(action))throw new TypeError('Decision action is invalid.');

  const generatedId=typeof idFactory==='function'?idFactory():null;
  const id=safeText(request.id||generatedId,120);
  if(!id||!SAFE_ID.test(id))throw new TypeError('Decision request id is invalid.');

  const actor=safeText(request.actor||'system',80);
  if(!actor||!SAFE_ID.test(actor))throw new TypeError('Decision actor is invalid.');

  const capability=request.capability===undefined||request.capability===null
    ?null
    :safeText(request.capability,120);
  if(capability!==null&&!SAFE_ID.test(capability))throw new TypeError('Decision capability is invalid.');

  return Object.freeze({
    id,
    action,
    actor,
    capability,
    target:safeText(request.target||'',160),
    label:safeText(request.label||action,160),
    requiredDependencies:Object.freeze(normalizeStringList(request.requiredDependencies)),
    requestedAt:Number.isInteger(request.requestedAt)&&request.requestedAt>=0?request.requestedAt:null
  });
}

function capabilityStatus(context,id){
  if(!id)return 'ready';
  if(context.deniedCapabilities?.includes(id))return 'denied';
  const capabilities=context.capabilities;
  if(Array.isArray(capabilities))return capabilities.includes(id)?'ready':'missing';
  if(capabilities instanceof Set)return capabilities.has(id)?'ready':'missing';
  if(capabilities&&typeof capabilities==='object'){
    const value=capabilities[id];
    if(value===true||READY_DEPENDENCY_STATES.has(String(value||'').toLowerCase()))return 'ready';
    if(value===false||value===undefined||value===null)return 'missing';
    return String(value).toLowerCase();
  }
  return 'unknown';
}

function dependencyStatus(context,id){
  const value=context.dependencies?.[id];
  if(value===true)return 'ready';
  if(value===false||value===undefined||value===null)return 'missing';
  return String(value).toLowerCase();
}

function gateReady(context,id){
  return context.gates?.[id]===true;
}

function hasApproval(context,id){
  const approvals=context.approvals;
  if(Array.isArray(approvals))return approvals.includes(id);
  if(approvals instanceof Set)return approvals.has(id);
  if(approvals&&typeof approvals==='object')return approvals[id]===true;
  return false;
}

function decision(outcome,reasonCodes,details={}){
  const codes=[...new Set(reasonCodes)];
  return {
    outcome,
    reasonCodes:codes,
    ...details
  };
}

export function evaluateDecisionRequest(request,context={},{
  policy=createDecisionPolicy()
}={}){
  const entry=policy[request.action];
  if(!entry){
    return decision(DECISION_OUTCOMES.BLOCK,[DECISION_REASON_CODES.UNKNOWN_ACTION],{
      risk:'critical',
      summary:'Action is not defined by the active NARA decision policy.',
      missingApprovals:[],
      missingDependencies:[],
      missingGates:[],
      capability:null,
      confidence:1
    });
  }

  if(context.safetyStop===true){
    return decision(DECISION_OUTCOMES.BLOCK,[DECISION_REASON_CODES.SAFETY_STOP],{
      risk:'critical',
      summary:'Safety stop is active.',
      missingApprovals:[],
      missingDependencies:[],
      missingGates:[],
      capability:null,
      confidence:1
    });
  }

  if(entry.enabled===false){
    return decision(DECISION_OUTCOMES.BLOCK,[DECISION_REASON_CODES.ACTION_DISABLED],{
      risk:entry.risk,
      summary:'Action is disabled by policy.',
      missingApprovals:[],
      missingDependencies:[],
      missingGates:[],
      capability:null,
      confidence:1
    });
  }

  const capability=entry.capability==='$request'?request.capability:entry.capability;
  if(entry.capability==='$request'&&!capability){
    return decision(DECISION_OUTCOMES.BLOCK,[DECISION_REASON_CODES.CAPABILITY_REQUIRED],{
      risk:entry.risk,
      summary:'The action requires an explicit capability identifier.',
      missingApprovals:[],
      missingDependencies:[],
      missingGates:[],
      capability:null,
      confidence:1
    });
  }

  if(capability){
    const status=capabilityStatus(context,capability);
    if(status==='denied'){
      return decision(DECISION_OUTCOMES.BLOCK,[DECISION_REASON_CODES.CAPABILITY_DENIED],{
        risk:entry.risk,
        summary:'The requested capability is denied by runtime policy.',
        missingApprovals:[],
        missingDependencies:[],
        missingGates:[],
        capability,
        confidence:1
      });
    }
    if(status!=='ready'){
      return decision(DECISION_OUTCOMES.DEFER,[DECISION_REASON_CODES.CAPABILITY_NOT_READY],{
        risk:entry.risk,
        summary:'The requested capability is not ready.',
        missingApprovals:[],
        missingDependencies:[],
        missingGates:[],
        capability,
        confidence:.9
      });
    }
  }

  const dependencies=[...new Set([
    ...(entry.defaultDependencies||[]),
    ...(request.requiredDependencies||[])
  ])];
  const missingDependencies=dependencies.filter(id=>!READY_DEPENDENCY_STATES.has(dependencyStatus(context,id)));
  if(missingDependencies.length){
    return decision(DECISION_OUTCOMES.DEFER,[DECISION_REASON_CODES.DEPENDENCY_NOT_READY],{
      risk:entry.risk,
      summary:'One or more runtime dependencies are not ready.',
      missingApprovals:[],
      missingDependencies,
      missingGates:[],
      capability,
      confidence:.95
    });
  }

  const missingGates=(entry.requiredGates||[]).filter(id=>!gateReady(context,id));
  if(missingGates.length){
    return decision(DECISION_OUTCOMES.DEFER,[DECISION_REASON_CODES.GATE_NOT_READY],{
      risk:entry.risk,
      summary:'One or more lifecycle gates have not been satisfied.',
      missingApprovals:[],
      missingDependencies:[],
      missingGates,
      capability,
      confidence:1
    });
  }

  const missingApprovals=(entry.requiredApprovals||[]).filter(id=>!hasApproval(context,id));
  if(missingApprovals.length){
    return decision(DECISION_OUTCOMES.REQUIRE_APPROVAL,[DECISION_REASON_CODES.APPROVAL_REQUIRED],{
      risk:entry.risk,
      summary:'Explicit approval is required before this action can proceed.',
      missingApprovals,
      missingDependencies:[],
      missingGates:[],
      capability,
      confidence:1
    });
  }

  return decision(DECISION_OUTCOMES.ALLOW,[DECISION_REASON_CODES.POLICY_ALLOW],{
    risk:entry.risk,
    summary:'Policy, capability, dependency, gate, and approval checks passed.',
    missingApprovals:[],
    missingDependencies:[],
    missingGates:[],
    capability,
    confidence:.99
  });
}
