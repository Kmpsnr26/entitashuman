import {evaluateHumanALEIntegrationRequest,getHumanALEIntegrationAction,NARA_HUMANALE_PROTOCOL} from './humanale-integration-contract.js';

export const NARA_HUMANALE_DRY_RUN_ROUTES=Object.freeze({
 'workflow.snapshot':Object.freeze({domain:'workflow',operation:'snapshot',mutating:false}),
 'workflow.queue':Object.freeze({domain:'workflow',operation:'queue',mutating:false}),
 'workflow.report':Object.freeze({domain:'workflow',operation:'report',mutating:false}),
 'skills.snapshot':Object.freeze({domain:'skills',operation:'snapshot',mutating:false}),
 'readiness.certificate':Object.freeze({domain:'readiness',operation:'certificate',mutating:false}),
 'workflow.start':Object.freeze({domain:'workflow',operation:'start',mutating:true}),
 'workflow.cancel':Object.freeze({domain:'workflow',operation:'cancel',mutating:true}),
 'workflow.permission.grant':Object.freeze({domain:'workflow',operation:'permission-grant',mutating:true}),
 'workflow.permission.revoke':Object.freeze({domain:'workflow',operation:'permission-revoke',mutating:true}),
 'workflow.recovery':Object.freeze({domain:'workflow',operation:'recovery',mutating:true}),
 'workflow.step.start':Object.freeze({domain:'workflow-step',operation:'start',mutating:true}),
 'workflow.step.complete':Object.freeze({domain:'workflow-step',operation:'complete',mutating:true}),
 'workflow.step.verify':Object.freeze({domain:'workflow-step',operation:'verify',mutating:true})
});

const freeze=value=>Object.freeze(value);

function routeFor(action){
 return Object.hasOwn(NARA_HUMANALE_DRY_RUN_ROUTES,action)?NARA_HUMANALE_DRY_RUN_ROUTES[action]:null;
}

export function previewHumanALEIntegrationRoute(request={},authoritySnapshot={}){
 const evaluated=evaluateHumanALEIntegrationRequest(request,authoritySnapshot);
 if(evaluated.decision==='block'){
  return freeze({
   protocol:NARA_HUMANALE_PROTOCOL,
   dryRun:true,
   executed:false,
   requestId:evaluated.requestId||'',
   action:evaluated.action||'',
   decision:'block',
   reason:evaluated.reason||'BLOCKED',
   route:null,
   requiresConfirmation:false
  });
 }
 const meta=getHumanALEIntegrationAction(evaluated.action);
 const route=routeFor(evaluated.action);
 if(!meta||!route){
  return freeze({
   protocol:NARA_HUMANALE_PROTOCOL,
   dryRun:true,
   executed:false,
   requestId:evaluated.requestId||'',
   action:evaluated.action||'',
   decision:'block',
   reason:'ROUTE_NOT_DEFINED',
   route:null,
   requiresConfirmation:false
  });
 }
 return freeze({
  protocol:NARA_HUMANALE_PROTOCOL,
  dryRun:true,
  executed:false,
  requestId:evaluated.requestId,
  action:evaluated.action,
  kind:evaluated.kind,
  capability:evaluated.capability,
  decision:evaluated.decision,
  reason:evaluated.reason,
  route,
  requiresConfirmation:evaluated.decision==='confirm',
  payload:evaluated.payload
 });
}

export function describeHumanALEIntegrationDryRun(authoritySnapshot={}){
 const previews=Object.keys(NARA_HUMANALE_DRY_RUN_ROUTES).map(action=>{
  const meta=getHumanALEIntegrationAction(action);
  const authority=authoritySnapshot?.bridge?.[meta?.capability];
  return freeze({
   action,
   domain:NARA_HUMANALE_DRY_RUN_ROUTES[action].domain,
   operation:NARA_HUMANALE_DRY_RUN_ROUTES[action].operation,
   mutating:NARA_HUMANALE_DRY_RUN_ROUTES[action].mutating,
   decision:['allow','confirm','block'].includes(authority?.decision)?authority.decision:'block'
  });
 });
 return freeze({
  version:1,
  protocol:NARA_HUMANALE_PROTOCOL,
  controlledBy:'NARA_CORE',
  mode:'DRY_RUN_ONLY',
  executed:false,
  mutationSurface:false,
  externalAdapter:false,
  ipcExposed:false,
  routes:freeze(previews)
 });
}
