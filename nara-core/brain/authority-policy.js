export const NARA_AUTHORITY_LIMITS=Object.freeze({maxHistory:64});

export const NARA_AUTHORITY_PHASES=Object.freeze([
 'development','validation','final-integration','released'
]);

export const NARA_CREATOR_DIRECTIVE=Object.freeze({
 id:'creator-final-integration-only',
 workflowAuthority:'NARA_CORE',
 integrationPolicy:'FINAL_INTEGRATION_ONLY',
 humanaleAuthority:'INTERFACE_ONLY_UNTIL_FINAL',
 externalExecution:'EXPLICIT_APPROVAL_REQUIRED'
});

const AUTO_PERMISSIONS=new Set([
 'sensor:read','state:read','memory:read','diagnostic:read','network:read',
 'repo:read','report:write','policy:enforce'
]);

const CONFIRM_PERMISSIONS=new Set([
 'audio:output','camera:read','memory:write-approved','agent:execute-approved',
 'terminal:bounded-execute','workspace:write-approved','repo:write-approved',
 'cloud:write-approved'
]);

export const NARA_KNOWN_PERMISSIONS=Object.freeze([
 ...AUTO_PERMISSIONS,
 ...CONFIRM_PERMISSIONS
]);

export const NARA_BRIDGE_CAPABILITIES=Object.freeze([
 'humanale:workflow-read',
 'humanale:workflow-control',
 'humanale:execution-request',
 'humanale:authority-control'
]);

const BRIDGE_RULES=Object.freeze({
 'humanale:workflow-read':Object.freeze({final:'allow',released:'allow'}),
 'humanale:workflow-control':Object.freeze({final:'confirm',released:'confirm'}),
 'humanale:execution-request':Object.freeze({final:'confirm',released:'confirm'}),
 'humanale:authority-control':Object.freeze({final:'block',released:'block'})
});

export function isKnownPermission(value){
 const permission=String(value||'').trim();
 return AUTO_PERMISSIONS.has(permission)||CONFIRM_PERMISSIONS.has(permission);
}

export function isAutoPermission(value){
 return AUTO_PERMISSIONS.has(String(value||'').trim());
}

export function isApprovalPermission(value){
 return CONFIRM_PERMISSIONS.has(String(value||'').trim())||String(value||'').trim().endsWith('-approved');
}

export function shouldInheritDependencyPermission(value){
 const permission=String(value||'').trim();
 return isKnownPermission(permission)&&!permission.endsWith('-approved');
}

export function permissionDecision(value,{mode='observe'}={}){
 const permission=String(value||'').trim();
 if(AUTO_PERMISSIONS.has(permission))return Object.freeze({permission,decision:'allow',reason:'AUTO_SAFE'});
 if(CONFIRM_PERMISSIONS.has(permission)){
  if(mode!=='execute')return Object.freeze({permission,decision:'block',reason:'OBSERVE_MODE'});
  return Object.freeze({permission,decision:'confirm',reason:'EXPLICIT_APPROVAL_REQUIRED'});
 }
 return Object.freeze({permission,decision:'block',reason:'UNKNOWN_PERMISSION'});
}

function phaseIndex(value){return NARA_AUTHORITY_PHASES.indexOf(String(value||''));}

export class NaraAuthorityPolicy{
 constructor({clock=()=>Date.now()}={}){
  this.clock=clock;
  this.phase='development';
  this.finalIntegrationApproved=false;
  this.history=[];
 }

 record(event,detail=''){
  const item=Object.freeze({
   event:String(event||'').slice(0,80),
   detail:String(detail||'').slice(0,160),
   timestamp:this.clock()
  });
  this.history=[...this.history,item].slice(-NARA_AUTHORITY_LIMITS.maxHistory);
  return item;
 }

 advancePhase(next,{creatorConfirmed=false}={}){
  const target=String(next||'');
  const currentIndex=phaseIndex(this.phase),targetIndex=phaseIndex(target);
  if(targetIndex<0)throw new Error('Fase authority NARA tidak dikenal: '+target);
  if(targetIndex!==currentIndex+1)throw new Error('Transisi fase NARA harus berurutan: '+this.phase+' -> '+target+'.');
  if(['final-integration','released'].includes(target)&&creatorConfirmed!==true){
   throw new Error('Fase '+target+' memerlukan konfirmasi eksplisit pencipta.');
  }
  this.phase=target;
  if(target==='final-integration')this.finalIntegrationApproved=true;
  if(target==='released'&&!this.finalIntegrationApproved)throw new Error('Final integration belum disetujui pencipta.');
  this.record('authority.phase',target);
  return this.snapshot();
 }

 evaluatePermission(permission,{mode='observe'}={}){
  return permissionDecision(permission,{mode});
 }

 evaluateBridge(capability){
  const name=String(capability||'').trim();
  if(!NARA_BRIDGE_CAPABILITIES.includes(name)){
   return Object.freeze({capability:name,decision:'block',reason:'UNKNOWN_BRIDGE_CAPABILITY'});
  }
  if(!this.finalIntegrationApproved||!['final-integration','released'].includes(this.phase)){
   return Object.freeze({capability:name,decision:'block',reason:'FINAL_INTEGRATION_LOCKED'});
  }
  const rules=BRIDGE_RULES[name];
  const key=this.phase==='released'?'released':'final';
  const decision=rules?.[key]||'block';
  const reason=decision==='allow'?'CREATOR_FINAL_INTEGRATION_APPROVED'
   :decision==='confirm'?'PER_ACTION_CONFIRMATION_REQUIRED'
   :'NARA_AUTHORITY_RESERVED';
  return Object.freeze({capability:name,decision,reason});
 }

 snapshot(){
  const bridge=Object.freeze(Object.fromEntries(
   NARA_BRIDGE_CAPABILITIES.map(capability=>[capability,this.evaluateBridge(capability)])
  ));
  return Object.freeze({
   version:1,
   controlledBy:'NARA_CORE',
   creatorDirective:NARA_CREATOR_DIRECTIVE,
   phase:this.phase,
   finalIntegrationApproved:this.finalIntegrationApproved,
   integrationLocked:!this.finalIntegrationApproved||!['final-integration','released'].includes(this.phase),
   bridge,
   history:Object.freeze([...this.history])
  });
 }
}

export function createAuthorityPolicy(options){return new NaraAuthorityPolicy(options);}
