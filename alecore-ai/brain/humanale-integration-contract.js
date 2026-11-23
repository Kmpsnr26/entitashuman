export const ALECORE_AI_HUMANALE_PROTOCOL='alecore-ai-humanale/1';

export const ALECORE_AI_HUMANALE_CONTRACT_LIMITS=Object.freeze({
 maxRequestId:40,
 maxWorkflowId:40,
 maxStepId:40,
 maxReason:160,
 maxPermissions:12
});

const freeze=value=>Object.freeze(value);
const safeId=value=>/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(value||''));
const bounded=(value,max)=>String(value??'').trim().slice(0,max);

const actions=Object.freeze({
 'workflow.snapshot':freeze({kind:'read',capability:'humanale:workflow-read',payload:'none'}),
 'workflow.queue':freeze({kind:'read',capability:'humanale:workflow-read',payload:'none'}),
 'workflow.report':freeze({kind:'read',capability:'humanale:workflow-read',payload:'none'}),
 'skills.snapshot':freeze({kind:'read',capability:'humanale:workflow-read',payload:'none'}),
 'readiness.certificate':freeze({kind:'read',capability:'humanale:workflow-read',payload:'none'}),

 'workflow.start':freeze({kind:'control',capability:'humanale:workflow-control',payload:'workflow'}),
 'workflow.cancel':freeze({kind:'control',capability:'humanale:workflow-control',payload:'reason'}),
 'workflow.permission.grant':freeze({kind:'control',capability:'humanale:workflow-control',payload:'permissions'}),
 'workflow.permission.revoke':freeze({kind:'control',capability:'humanale:workflow-control',payload:'permissions'}),
 'workflow.recovery':freeze({kind:'control',capability:'humanale:workflow-control',payload:'step'}),

 'workflow.step.start':freeze({kind:'execution',capability:'humanale:execution-request',payload:'step'}),
 'workflow.step.complete':freeze({kind:'execution',capability:'humanale:execution-request',payload:'step-result'}),
 'workflow.step.verify':freeze({kind:'execution',capability:'humanale:execution-request',payload:'verification'})
});

export const ALECORE_AI_HUMANALE_ACTIONS=freeze(Object.keys(actions));

export function isHumanALEIntegrationAction(value){
 return typeof value==='string'&&Object.hasOwn(actions,value);
}

export function getHumanALEIntegrationAction(value){
 return isHumanALEIntegrationAction(value)?actions[value]:null;
}

function normalizePermissions(value){
 if(!Array.isArray(value))return [];
 return [...new Set(value.map(item=>bounded(item,80)).filter(Boolean))].slice(0,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxPermissions);
}

function normalizePayload(type,value={}){
 const payload=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 if(type==='none')return freeze({});
 if(type==='workflow'){
  const workflowId=bounded(payload.workflowId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxWorkflowId);
  return freeze({workflowId:safeId(workflowId)?workflowId:''});
 }
 if(type==='reason')return freeze({reason:bounded(payload.reason,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxReason)});
 if(type==='permissions')return freeze({permissions:freeze(normalizePermissions(payload.permissions))});
 if(type==='step'){
  const stepId=bounded(payload.stepId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxStepId);
  return freeze({stepId:safeId(stepId)?stepId:''});
 }
 if(type==='step-result'){
  const stepId=bounded(payload.stepId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxStepId);
  return freeze({
   stepId:safeId(stepId)?stepId:'',
   result:bounded(payload.result,320)
  });
 }
 if(type==='verification'){
  const stepId=bounded(payload.stepId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxStepId);
  return freeze({
   stepId:safeId(stepId)?stepId:'',
   ok:payload.ok===true,
   message:bounded(payload.message,320)
  });
 }
 return freeze({});
}

function validateNormalizedPayload(meta,payload){
 if(meta.payload==='workflow'&&!payload.workflowId)return 'INVALID_WORKFLOW_ID';
 if(['step','step-result','verification'].includes(meta.payload)&&!payload.stepId)return 'INVALID_STEP_ID';
 if(meta.payload==='permissions'&&!payload.permissions.length)return 'EMPTY_PERMISSION_LIST';
 return '';
}

export function normalizeHumanALEIntegrationRequest(value={}){
 const requestId=bounded(value?.requestId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxRequestId);
 const action=bounded(value?.action,80);
 if(!safeId(requestId))throw new Error('Request ID integrasi HumanALE tidak valid.');
 if(!isHumanALEIntegrationAction(action))throw new Error('Action integrasi HumanALE tidak dikenal: '+action);
 const meta=actions[action];
 const payload=normalizePayload(meta.payload,value?.payload);
 const invalid=validateNormalizedPayload(meta,payload);
 if(invalid)throw new Error('Payload integrasi HumanALE tidak valid: '+invalid);
 return freeze({
  protocol:ALECORE_AI_HUMANALE_PROTOCOL,
  requestId,
  action,
  kind:meta.kind,
  capability:meta.capability,
  payload
 });
}

export function evaluateHumanALEIntegrationRequest(value={},authoritySnapshot={}){
 let request;
 try{request=normalizeHumanALEIntegrationRequest(value);}
 catch(error){
  return freeze({
   protocol:ALECORE_AI_HUMANALE_PROTOCOL,
   requestId:bounded(value?.requestId,ALECORE_AI_HUMANALE_CONTRACT_LIMITS.maxRequestId),
   action:bounded(value?.action,80),
   decision:'block',
   reason:'INVALID_REQUEST',
   error:String(error?.message||'Request integrasi tidak valid.').slice(0,200)
  });
 }
 const authority=authoritySnapshot?.bridge?.[request.capability];
 if(!authority){
  return freeze({...request,decision:'block',reason:'AUTHORITY_DECISION_MISSING'});
 }
 const decision=['allow','confirm','block'].includes(authority.decision)?authority.decision:'block';
 return freeze({
  ...request,
  decision,
  reason:String(authority.reason||'AUTHORITY_BLOCK').slice(0,120)
 });
}

export function describeHumanALEIntegrationContract(authoritySnapshot={}){
 const actionList=ALECORE_AI_HUMANALE_ACTIONS.map(action=>{
  const meta=actions[action];
  const authority=authoritySnapshot?.bridge?.[meta.capability];
  return freeze({
   action,
   kind:meta.kind,
   capability:meta.capability,
   decision:['allow','confirm','block'].includes(authority?.decision)?authority.decision:'block'
  });
 });
 return freeze({
  version:1,
  protocol:ALECORE_AI_HUMANALE_PROTOCOL,
  controlledBy:'ALECORE_AI',
  integrationPolicy:'FINAL_INTEGRATION_ONLY',
  directMethodAccess:false,
  arbitraryDispatch:false,
  authorityControl:false,
  actions:freeze(actionList)
 });
}
