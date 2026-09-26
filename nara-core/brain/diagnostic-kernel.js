import {validateSkillDependencyGraph} from './skill-registry.js';

export const NARA_DIAGNOSTIC_LIMITS=Object.freeze({
 maxFindings:24,
 maxHistory:64,
 maxRecoveryActions:16,
 maxBlockersPerFinding:6
});

const SEVERITY_ORDER=Object.freeze({info:0,medium:1,high:2,critical:3});
const safe=value=>String(value??'').slice(0,120);

function freezeFinding(value){
 return Object.freeze({
  code:safe(value.code),
  severity:SEVERITY_ORDER[value.severity]===undefined?'medium':value.severity,
  category:safe(value.category),
  target:safe(value.target),
  detail:safe(value.detail),
  meta:Object.freeze({...value.meta})
 });
}

function uniqueFindings(values=[]){
 const seen=new Set(),result=[];
 for(const finding of values){
  const item=freezeFinding(finding);
  const key=[item.code,item.category,item.target].join('|');
  if(seen.has(key))continue;
  seen.add(key);result.push(item);
  if(result.length>=NARA_DIAGNOSTIC_LIMITS.maxFindings)break;
 }
 return result;
}

function deriveStatus(findings){
 const highest=findings.reduce((rank,item)=>Math.max(rank,SEVERITY_ORDER[item.severity]??0),0);
 return highest>=3?'critical':highest===2?'degraded':highest===1?'attention':'healthy';
}

function countSeverities(findings){
 return Object.freeze({
  total:findings.length,
  critical:findings.filter(item=>item.severity==='critical').length,
  high:findings.filter(item=>item.severity==='high').length,
  medium:findings.filter(item=>item.severity==='medium').length,
  info:findings.filter(item=>item.severity==='info').length
 });
}

export class NaraDiagnosticKernel{
 constructor({clock=()=>Date.now()}={}){
  this.clock=clock;
  this.history=[];
  this.last=null;
 }

 scan({brainState={},skills={},workflow={},authority={}}={}){
  const findings=[];
  const add=value=>findings.push(value);

  if(String(brainState?.lifecycle||'idle')!=='active'){
   add({code:'NARA_LIFECYCLE_INACTIVE',severity:'critical',category:'core',target:'NARA_CORE',detail:'NARA Core lifecycle is not active.',meta:{}});
  }

  for(const [id,region] of Object.entries(brainState?.regions||{})){
   const status=String(region?.status||'idle');
   if(status==='error')add({code:'REGION_ERROR',severity:'high',category:'region',target:id,detail:'NARA region reports an error state.',meta:{status}});
   else if(status==='bug')add({code:'REGION_BUG',severity:'high',category:'region',target:id,detail:'NARA region reports a bug state.',meta:{status}});
  }

  if(skills?.controlledBy&&skills.controlledBy!=='NARA_CORE'){
   add({code:'SKILL_AUTHORITY_MISMATCH',severity:'critical',category:'authority',target:'skill-registry',detail:'Skill snapshot authority is not NARA Core.',meta:{}});
  }
  for(const [id,skill] of Object.entries(skills?.skills||{})){
   const state=String(skill?.state||'setup');
   if(state==='error')add({code:'SKILL_ERROR',severity:'high',category:'skill',target:id,detail:'Skill is in error state.',meta:{region:safe(skill?.region)}});
   else if(state==='blocked')add({code:'SKILL_BLOCKED',severity:'medium',category:'skill',target:id,detail:'Skill dependencies or policy are blocking readiness.',meta:{missingDependencies:Object.freeze((skill?.missingDependencies||[]).map(safe).slice(0,6))}});
   else if(state==='offline')add({code:'SKILL_OFFLINE',severity:'medium',category:'skill',target:id,detail:'Skill is offline.',meta:{region:safe(skill?.region)}});
   else if(state==='setup')add({code:'SKILL_SETUP',severity:'info',category:'skill',target:id,detail:'Optional skill still requires setup.',meta:{region:safe(skill?.region)}});
  }

  const graph=validateSkillDependencyGraph();
  if(!graph.ok)add({code:'SKILL_DEPENDENCY_GRAPH_INVALID',severity:'critical',category:'dependency',target:'skill-registry',detail:'Skill dependency graph is invalid.',meta:{cycle:Object.freeze((graph.cycle||[]).map(safe).slice(0,12))}});

  if(workflow?.workflow){
   if(workflow.controlledBy!=='NARA_CORE'||workflow.executionBoundary!=='NARA_CORE_ONLY'){
    add({code:'WORKFLOW_AUTHORITY_MISMATCH',severity:'critical',category:'authority',target:'workflow',detail:'Workflow execution boundary is not NARA Core only.',meta:{}});
   }
   if(workflow.state==='failed'){
    add({code:'WORKFLOW_FAILED',severity:'high',category:'workflow',target:safe(workflow.workflow.id),detail:'Workflow has failed and requires recovery review.',meta:{}});
   }else if(workflow.state==='blocked'){
    add({code:'WORKFLOW_BLOCKED',severity:'medium',category:'workflow',target:safe(workflow.workflow.id),detail:'Workflow is blocked by dependency, mode, skill, or permission gates.',meta:{}});
   }
   for(const step of Object.values(workflow.workflow.steps||{})){
    if(step?.status==='failed'){
     add({code:'WORKFLOW_STEP_FAILED',severity:'high',category:'workflow-step',target:safe(step.id),detail:'Workflow step failed.',meta:{skill:safe(step.skill),attempts:Math.max(0,Math.min(99,Number(step.attempts)||0))}});
    }else if(step?.status==='blocked'){
     add({code:'WORKFLOW_STEP_BLOCKED',severity:'medium',category:'workflow-step',target:safe(step.id),detail:'Workflow step is blocked.',meta:{skill:safe(step.skill),blockers:Object.freeze((step.blockers||[]).map(safe).slice(0,NARA_DIAGNOSTIC_LIMITS.maxBlockersPerFinding))}});
    }
   }
   for(const permission of workflow.permissions?.missing||[]){
    add({code:'WORKFLOW_PERMISSION_REQUIRED',severity:'medium',category:'permission',target:safe(permission),detail:'Workflow requires explicit permission before execution can continue.',meta:{}});
   }
  }

  if(authority?.controlledBy&&authority.controlledBy!=='NARA_CORE'){
   add({code:'AUTHORITY_OWNER_MISMATCH',severity:'critical',category:'authority',target:'authority-policy',detail:'Authority owner is not NARA Core.',meta:{}});
  }
  if(authority?.integrationLocked===false&&!['final-integration','released'].includes(authority?.phase)){
   add({code:'FINAL_INTEGRATION_LOCK_INVALID',severity:'critical',category:'authority',target:'humanale-bridge',detail:'HumanALE integration lock is open outside the approved final phase.',meta:{phase:safe(authority?.phase)}});
  }
  const authorityControl=authority?.bridge?.['humanale:authority-control'];
  if(authorityControl&&authorityControl.decision!=='block'){
   add({code:'HUMANALE_AUTHORITY_ESCAPE',severity:'critical',category:'authority',target:'humanale:authority-control',detail:'HumanALE must never control NARA authority policy.',meta:{}});
  }

  const normalized=uniqueFindings(findings);
  const snapshot=Object.freeze({
   version:1,
   controlledBy:'NARA_CORE',
   executionBoundary:'NARA_CORE_ONLY',
   timestamp:this.clock(),
   status:deriveStatus(normalized),
   counts:countSeverities(normalized),
   findings:Object.freeze(normalized)
  });
  this.last=snapshot;
  this.history=[...this.history,Object.freeze({
   timestamp:snapshot.timestamp,
   status:snapshot.status,
   counts:snapshot.counts
  })].slice(-NARA_DIAGNOSTIC_LIMITS.maxHistory);
  return snapshot;
 }

 recoveryPlan(snapshot=this.last){
  const source=snapshot||Object.freeze({findings:[]});
  const actions=[],seen=new Set();
  const add=action=>{
   const key=[action.type,action.target].join('|');
   if(seen.has(key)||actions.length>=NARA_DIAGNOSTIC_LIMITS.maxRecoveryActions)return;
   seen.add(key);
   actions.push(Object.freeze({
    id:'recovery-'+(actions.length+1),
    type:safe(action.type),
    target:safe(action.target),
    reason:safe(action.reason),
    automatic:false,
    requiresConfirmation:Boolean(action.requiresConfirmation)
   }));
  };
  for(const finding of source.findings||[]){
   if(finding.code==='NARA_LIFECYCLE_INACTIVE')add({type:'review-core-lifecycle',target:'NARA_CORE',reason:finding.code,requiresConfirmation:true});
   else if(['REGION_ERROR','REGION_BUG'].includes(finding.code))add({type:'inspect-region',target:finding.target,reason:finding.code});
   else if(finding.code==='SKILL_BLOCKED')add({type:'restore-skill-dependency',target:finding.target,reason:finding.code});
   else if(finding.code==='SKILL_OFFLINE')add({type:'restore-skill-connection',target:finding.target,reason:finding.code,requiresConfirmation:true});
   else if(finding.code==='WORKFLOW_STEP_FAILED'){
    const attempts=Number(finding.meta?.attempts)||0;
    add({
     type:attempts<2?'retry-workflow-step':'review-workflow-step',
     target:finding.target,
     reason:attempts<2?'BOUNDED_RETRY_AVAILABLE':'RETRY_LIMIT_REACHED',
     requiresConfirmation:true
    });
   }else if(finding.code==='WORKFLOW_PERMISSION_REQUIRED')add({type:'request-confirmation',target:finding.target,reason:finding.code,requiresConfirmation:true});
   else if(['WORKFLOW_AUTHORITY_MISMATCH','AUTHORITY_OWNER_MISMATCH','FINAL_INTEGRATION_LOCK_INVALID','HUMANALE_AUTHORITY_ESCAPE','SKILL_DEPENDENCY_GRAPH_INVALID'].includes(finding.code)){
    add({type:'halt-and-review-authority',target:finding.target,reason:finding.code,requiresConfirmation:true});
   }
  }
  return Object.freeze({
   version:1,
   controlledBy:'NARA_CORE',
   executionBoundary:'NARA_CORE_ONLY',
   generatedAt:this.clock(),
   sourceStatus:source.status||'unknown',
   actions:Object.freeze(actions)
  });
 }

 snapshot(){
  return Object.freeze({
   version:1,
   controlledBy:'NARA_CORE',
   executionBoundary:'NARA_CORE_ONLY',
   last:this.last,
   history:Object.freeze([...this.history])
  });
 }
}

export function createDiagnosticKernel(options){return new NaraDiagnosticKernel(options);}
