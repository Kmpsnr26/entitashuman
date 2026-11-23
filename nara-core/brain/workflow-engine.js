import {getSkill,isSkillId} from './skill-registry.js';
import {isAutoPermission,isApprovalPermission,isKnownPermission,permissionDecision,shouldInheritDependencyPermission} from './authority-policy.js';

export const NARA_WORKFLOW_LIMITS=Object.freeze({
 maxSteps:12,
 maxDependenciesPerStep:6,
 maxGoalLength:240,
 maxLabelLength:120,
 maxResultLength:320,
 maxRetries:2,
 maxHistory:32
});

export const NARA_WORKFLOW_STATES=Object.freeze([
 'idle','planned','running','blocked','verifying','completed','failed','cancelled'
]);

export const NARA_WORKFLOW_STEP_STATES=Object.freeze([
 'queued','ready','blocked','running','verifying','complete','failed','cancelled'
]);

const bounded=(value,max)=>String(value??'').trim().slice(0,max);
const safeId=value=>/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(value||''));

function cloneStep(step){
 return {
  id:step.id,
  label:step.label,
  skill:step.skill,
  dependsOn:[...step.dependsOn],
  permissions:[...step.permissions],
  approvalRequired:step.approvalRequired,
  status:step.status,
  blockers:[...step.blockers],
  attempts:step.attempts,
  startedAt:step.startedAt,
  finishedAt:step.finishedAt,
  result:step.result
 };
}

function skillPermissionClosure(skillId,seen=new Set(),root=true){
 if(seen.has(skillId))return [];
 seen.add(skillId);
 const skill=getSkill(skillId);
 if(!skill)return [];
 const direct=root
  ?[...skill.permissions]
  :skill.permissions.filter(permission=>shouldInheritDependencyPermission(permission));
 const inherited=skill.dependencies.flatMap(dependency=>skillPermissionClosure(dependency,seen,false));
 return [...new Set([...direct,...inherited])];
}

function validateStepGraph(steps){
 const ids=new Set(steps.map(step=>step.id));
 for(const step of steps){
  for(const dependency of step.dependsOn){
   if(!ids.has(dependency))throw new Error('Dependency workflow tidak dikenal: '+dependency);
   if(dependency===step.id)throw new Error('Step workflow tidak boleh bergantung pada dirinya sendiri: '+step.id);
  }
 }
 const visiting=new Set(),visited=new Set(),path=[];
 const byId=Object.fromEntries(steps.map(step=>[step.id,step]));
 const visit=id=>{
  if(visiting.has(id)){
   const start=path.indexOf(id);
   throw new Error('Workflow dependency cycle: '+[...path.slice(start),id].join(' -> '));
  }
  if(visited.has(id))return;
  visiting.add(id);path.push(id);
  for(const dep of byId[id].dependsOn)visit(dep);
  path.pop();visiting.delete(id);visited.add(id);
 };
 for(const step of steps)visit(step.id);
}

export function normalizeWorkflowPlan(value={}){
 const goal=bounded(value.goal,NARA_WORKFLOW_LIMITS.maxGoalLength);
 if(!goal)throw new Error('Goal workflow wajib diisi.');
 const rawSteps=Array.isArray(value.steps)?value.steps:[];
 if(!rawSteps.length||rawSteps.length>NARA_WORKFLOW_LIMITS.maxSteps){
  throw new Error('Workflow harus memiliki 1–'+NARA_WORKFLOW_LIMITS.maxSteps+' step.');
 }
 const seen=new Set();
 const steps=rawSteps.map((raw,index)=>{
  const id=bounded(raw?.id||('step-'+(index+1)),40).toLowerCase();
  if(!safeId(id))throw new Error('ID step workflow tidak valid: '+id);
  if(seen.has(id))throw new Error('ID step workflow duplikat: '+id);
  seen.add(id);
  const skillId=bounded(raw?.skill,48);
  if(!isSkillId(skillId))throw new Error('Skill workflow tidak dikenal: '+skillId);
  const skill=getSkill(skillId);
  const dependsOn=[...new Set((Array.isArray(raw?.dependsOn)?raw.dependsOn:[]).map(item=>bounded(item,40).toLowerCase()).filter(Boolean))];
  if(dependsOn.length>NARA_WORKFLOW_LIMITS.maxDependenciesPerStep)throw new Error('Dependency step terlalu banyak: '+id);
  const permissions=skillPermissionClosure(skillId);
  return {
   id,
   label:bounded(raw?.label||skill.label,NARA_WORKFLOW_LIMITS.maxLabelLength),
   skill:skillId,
   dependsOn,
   permissions,
   approvalRequired:permissions.some(permission=>isApprovalPermission(permission))
  };
 });
 validateStepGraph(steps);
 return Object.freeze({
  id:safeId(value.id)?String(value.id):'workflow',
  goal,
  mode:value.mode==='execute'?'execute':'observe',
  steps:Object.freeze(steps.map(step=>Object.freeze({...step,dependsOn:Object.freeze([...step.dependsOn]),permissions:Object.freeze([...step.permissions])})))
 });
}

function workflowRequiredPermissions(plan){
 return [...new Set(plan.steps.flatMap(step=>step.permissions))];
}

function initialGrantedPermissions(plan){
 return workflowRequiredPermissions(plan).filter(permission=>isAutoPermission(permission));
}

function skillBlockers(step,skillSnapshot={}){
 const skill=skillSnapshot?.skills?.[step.skill];
 if(!skill)return ['skill-unavailable:'+step.skill];
 const blockers=[];
 if(['error','offline','setup'].includes(skill.state))blockers.push('skill-'+skill.state+':'+step.skill);
 if(skill.state==='blocked'){
  for(const dep of skill.missingDependencies||[])blockers.push('skill-dependency:'+dep);
  if(!(skill.missingDependencies||[]).length)blockers.push('skill-blocked:'+step.skill);
 }
 return blockers;
}

function stepBlockers(step,steps,granted,skillSnapshot,mode='observe'){
 const blockers=[];
 if(mode!=='execute'&&step.approvalRequired)blockers.push('mode:observe');
 for(const id of step.dependsOn){
  if(steps[id]?.status!=='complete')blockers.push('step:'+id);
 }
 for(const permission of step.permissions){
  if(!granted.has(permission))blockers.push('permission:'+permission);
 }
 blockers.push(...skillBlockers(step,skillSnapshot));
 return [...new Set(blockers)];
}

function counts(steps){
 const values=Object.values(steps);
 return {
  total:values.length,
  queued:values.filter(step=>step.status==='queued').length,
  ready:values.filter(step=>step.status==='ready').length,
  blocked:values.filter(step=>step.status==='blocked').length,
  running:values.filter(step=>step.status==='running').length,
  verifying:values.filter(step=>step.status==='verifying').length,
  complete:values.filter(step=>step.status==='complete').length,
  failed:values.filter(step=>step.status==='failed').length,
  cancelled:values.filter(step=>step.status==='cancelled').length
 };
}

export class NaraWorkflowEngine{
 constructor({bus=null,clock=()=>Date.now()}={}){
  this.bus=bus;
  this.clock=clock;
  this.serial=0;
  this.reset();
 }

 reset(){
  this.workflow=null;
  this.granted=new Set();
  this.skillSnapshot=null;
  this.history=[];
  this.checkpoints=[];
  return this.snapshot();
 }

 record(event,payload={}){
  const item=Object.freeze({
   event:String(event||'').slice(0,80),
   timestamp:this.clock(),
   workflowId:String(payload.workflowId||this.workflow?.id||'').slice(0,40),
   stepId:String(payload.stepId||'').slice(0,40),
   skill:String(payload.skill||'').slice(0,48),
   reason:String(payload.reason||'').slice(0,120)
  });
  this.history=[...this.history,item].slice(-NARA_WORKFLOW_LIMITS.maxHistory);
  return item;
 }

 emit(event,payload={}){
  this.record(event,payload);
  if(this.workflow)this.workflow.lastEvent=event;
  if(this.bus?.emit)this.bus.emit(event,payload,{source:'nara-workflow'});
 }

 create(planValue,skillSnapshot={}){
  if(this.workflow&&!['completed','failed','cancelled'].includes(this.workflow.state))throw new Error('Workflow AleCore AI aktif harus diselesaikan atau dibatalkan terlebih dahulu.');
  const plan=normalizeWorkflowPlan(planValue);
  const now=this.clock();
  const id=plan.id==='workflow'?'workflow-'+(++this.serial):plan.id;
  const steps=Object.fromEntries(plan.steps.map(step=>[step.id,{
   ...step,status:'queued',blockers:[],attempts:0,startedAt:0,finishedAt:0,result:''
  }]));
  this.history=[];
  this.checkpoints=[];
  this.workflow={
   id,goal:plan.goal,mode:plan.mode,state:'planned',
   createdAt:now,startedAt:0,finishedAt:0,
   steps,order:plan.steps.map(step=>step.id),
   lastEvent:'workflow.planned'
  };
  this.granted=new Set(initialGrantedPermissions(plan));
  this.skillSnapshot=skillSnapshot||{};
  this.refresh(skillSnapshot);
  this.workflow.state='planned';
  this.emit('workflow.planned',{workflowId:id,goal:plan.goal,steps:plan.steps.length,mode:plan.mode});
  return this.snapshot();
 }

 requiredPermissions(){
  if(!this.workflow)return [];
  return [...new Set(this.workflow.order.flatMap(id=>this.workflow.steps[id].permissions))];
 }

 missingPermissions(){
  return this.requiredPermissions().filter(permission=>!this.granted.has(permission));
 }

 grantPermissions(values=[],skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const required=new Set(this.requiredPermissions());
  const list=[...new Set((Array.isArray(values)?values:[]).map(item=>String(item||'').trim()).filter(Boolean))];
  for(const permission of list){
   if(!required.has(permission))throw new Error('Permission tidak dibutuhkan workflow: '+permission);
   const decision=permissionDecision(permission,{mode:this.workflow.mode});
   if(decision.decision==='block'){
    if(decision.reason==='OBSERVE_MODE')throw new Error('Workflow observe tidak dapat menerima permission eksekusi: '+permission);
    throw new Error('Permission workflow tidak dikenal: '+permission);
   }
   this.granted.add(permission);
  }
  this.emit('workflow.permission.granted',{workflowId:this.workflow.id,permissions:list});
  return this.refresh(skillSnapshot);
 }

 revokePermissions(values=[],skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const revoked=[];
  for(const value of Array.isArray(values)?values:[]){
   const permission=String(value||'').trim();
   if(!permission||isAutoPermission(permission))continue;
   if(this.granted.delete(permission))revoked.push(permission);
  }
  const active=Object.values(this.workflow.steps).find(step=>
   ['running','verifying'].includes(step.status)&&step.permissions.some(permission=>revoked.includes(permission))
  );
  if(active){
   const permission=active.permissions.find(item=>revoked.includes(item))||'unknown';
   active.status='failed';active.finishedAt=this.clock();active.blockers=['permission-revoked:'+permission];
   this.workflow.state='failed';this.workflow.lastEvent='workflow.step.failed';
   this.emit('workflow.step.failed',{workflowId:this.workflow.id,stepId:active.id,skill:active.skill,reason:'permission-revoked:'+permission});
  }
  this.emit('workflow.permission.revoked',{workflowId:this.workflow.id,permissions:revoked});
  return active?this.snapshot():this.refresh(skillSnapshot);
 }

 refresh(skillSnapshot=this.skillSnapshot){
  if(!this.workflow)return this.snapshot();
  this.skillSnapshot=skillSnapshot||{};
  const previousState=this.workflow.state;
  const steps=this.workflow.steps;
  for(const id of this.workflow.order){
   const step=steps[id];
   if(['running','verifying','complete','failed','cancelled'].includes(step.status))continue;
   const blockers=stepBlockers(step,steps,this.granted,this.skillSnapshot,this.workflow.mode);
   step.blockers=blockers;
   step.status=blockers.length?'blocked':'ready';
  }
  const c=counts(steps);
  if(this.workflow.state==='running'||this.workflow.state==='blocked'||this.workflow.state==='verifying'){
   if(c.failed)this.workflow.state='failed';
   else if(c.complete===c.total)this.finishWorkflow();
   else if(c.verifying)this.workflow.state='verifying';
   else if(c.running||c.ready)this.workflow.state='running';
   else this.workflow.state='blocked';
  }
  if(previousState!==this.workflow.state){
   if(this.workflow.state==='blocked')this.emit('workflow.blocked',{workflowId:this.workflow.id,reason:'no-ready-step'});
   else if(previousState==='blocked'&&this.workflow.state==='running')this.emit('workflow.resumed',{workflowId:this.workflow.id});
  }
  return this.snapshot();
 }

 start(skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  if(this.workflow.state!=='planned'&&this.workflow.state!=='blocked')throw new Error('Workflow AleCore AI tidak dapat dimulai dari state '+this.workflow.state+'.');
  if(!this.workflow.startedAt)this.workflow.startedAt=this.clock();
  this.workflow.state='running';
  this.emit('workflow.started',{workflowId:this.workflow.id,goal:this.workflow.goal});
  return this.refresh(skillSnapshot);
 }

 nextReady(){
  if(!this.workflow)return null;
  const id=this.workflow.order.find(stepId=>this.workflow.steps[stepId].status==='ready');
  return id?cloneStep(this.workflow.steps[id]):null;
 }

 startStep(id,skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  if(this.workflow.state!=='running')throw new Error('Workflow AleCore AI belum dalam state running.');
  if(Object.values(this.workflow.steps).some(step=>step.status==='running'||step.status==='verifying'))throw new Error('Hanya satu step workflow NARA boleh aktif pada satu waktu.');
  this.refresh(skillSnapshot);
  const step=this.workflow.steps[id];
  if(!step)throw new Error('Step workflow tidak dikenal: '+id);
  if(step.status!=='ready')throw new Error('Step workflow belum siap: '+id+' ['+step.blockers.join(', ')+']');
  step.status='running';step.blockers=[];step.attempts++;step.startedAt=this.clock();step.finishedAt=0;
  this.workflow.state='running';this.workflow.lastEvent='workflow.step.start';
  this.emit('workflow.step.start',{workflowId:this.workflow.id,stepId:id,skill:step.skill,label:step.label,attempt:step.attempts});
  return this.snapshot();
 }

 completeStep(id,result=''){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const step=this.workflow.steps[id];
  if(!step||step.status!=='running')throw new Error('Step workflow tidak sedang berjalan: '+id);
  step.status='verifying';
  step.result=bounded(result,NARA_WORKFLOW_LIMITS.maxResultLength);
  this.workflow.state='verifying';this.workflow.lastEvent='workflow.verify.start';
  this.emit('workflow.verify.start',{workflowId:this.workflow.id,stepId:id,skill:step.skill});
  return this.snapshot();
 }

 verifyStep(id,{ok=true,message=''}={},skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const step=this.workflow.steps[id];
  if(!step||step.status!=='verifying')throw new Error('Step workflow belum dalam verifikasi: '+id);
  if(ok){
   step.status='complete';step.finishedAt=this.clock();
   if(message)step.result=bounded(message,NARA_WORKFLOW_LIMITS.maxResultLength);
   this.checkpoints=[...this.checkpoints,Object.freeze({
    stepId:id,skill:step.skill,attempt:step.attempts,
    result:bounded(step.result,NARA_WORKFLOW_LIMITS.maxResultLength),
    timestamp:step.finishedAt
   })].slice(-NARA_WORKFLOW_LIMITS.maxSteps);
   this.workflow.lastEvent='workflow.verify.complete';
   this.emit('workflow.verify.complete',{workflowId:this.workflow.id,stepId:id,skill:step.skill,ok:true});
   this.refresh(skillSnapshot);
  }else{
   step.status='failed';step.finishedAt=this.clock();
   step.blockers=['verification-failed'];
   if(message)step.result=bounded(message,NARA_WORKFLOW_LIMITS.maxResultLength);
   this.workflow.state='failed';this.workflow.lastEvent='workflow.step.failed';
   this.emit('workflow.step.failed',{workflowId:this.workflow.id,stepId:id,skill:step.skill,reason:'verification-failed'});
  }
  return this.snapshot();
 }

 failStep(id,reason='execution-failed'){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const step=this.workflow.steps[id];
  if(!step||!['running','verifying'].includes(step.status))throw new Error('Step workflow tidak aktif: '+id);
  step.status='failed';step.finishedAt=this.clock();step.blockers=[bounded(reason,120)||'execution-failed'];
  this.workflow.state='failed';this.workflow.lastEvent='workflow.step.failed';
  this.emit('workflow.step.failed',{workflowId:this.workflow.id,stepId:id,skill:step.skill,reason:step.blockers[0]});
  return this.snapshot();
 }

 recoverStep(id,skillSnapshot=this.skillSnapshot){
  if(!this.workflow)throw new Error('Workflow AleCore AI belum dibuat.');
  const step=this.workflow.steps[id];
  if(!step||step.status!=='failed')throw new Error('Step workflow tidak gagal: '+id);
  if(step.attempts>=NARA_WORKFLOW_LIMITS.maxRetries)throw new Error('Batas retry workflow tercapai untuk '+id+'.');
  step.status='queued';step.blockers=[];step.startedAt=0;step.finishedAt=0;
  this.workflow.state='running';this.workflow.lastEvent='workflow.recovery';
  this.emit('workflow.recovery',{workflowId:this.workflow.id,stepId:id,skill:step.skill,nextAttempt:step.attempts+1});
  return this.refresh(skillSnapshot);
 }

 cancel(reason='cancelled'){
  if(!this.workflow)return this.snapshot();
  if(['completed','cancelled'].includes(this.workflow.state))return this.snapshot();
  for(const step of Object.values(this.workflow.steps)){
   if(!['complete','failed'].includes(step.status))step.status='cancelled';
  }
  this.workflow.state='cancelled';this.workflow.finishedAt=this.clock();this.workflow.lastEvent='workflow.cancelled';
  this.emit('workflow.cancelled',{workflowId:this.workflow.id,reason:bounded(reason,120)});
  return this.snapshot();
 }

 finishWorkflow(){
  if(!this.workflow)return;
  this.workflow.state='completed';this.workflow.finishedAt=this.clock();this.workflow.lastEvent='workflow.complete';
  this.emit('workflow.complete',{workflowId:this.workflow.id,goal:this.workflow.goal});
 }

 queue(){
  if(!this.workflow)return Object.freeze({active:null,next:null,ready:Object.freeze([]),blocked:Object.freeze([]),verifying:null});
  const values=this.workflow.order.map(id=>this.workflow.steps[id]);
  const active=values.find(step=>step.status==='running')||null;
  const verifying=values.find(step=>step.status==='verifying')||null;
  const ready=values.filter(step=>step.status==='ready').map(step=>step.id);
  const blocked=values.filter(step=>step.status==='blocked').map(step=>Object.freeze({id:step.id,blockers:Object.freeze([...step.blockers])}));
  return Object.freeze({
   active:active?.id||null,
   verifying:verifying?.id||null,
   next:ready[0]||null,
   ready:Object.freeze(ready),
   blocked:Object.freeze(blocked)
  });
 }

 report(){
  const snapshot=this.snapshot();
  if(!snapshot.workflow)return Object.freeze({controlledBy:'NARA_CORE',state:'idle',generatedAt:this.clock()});
  const workflow=snapshot.workflow;
  return Object.freeze({
   controlledBy:'NARA_CORE',
   executionBoundary:'NARA_CORE_ONLY',
   generatedAt:this.clock(),
   workflowId:workflow.id,
   goal:workflow.goal,
   mode:workflow.mode,
   state:workflow.state,
   progress:workflow.progress,
   counts:workflow.counts,
   queue:snapshot.queue,
   permissions:snapshot.permissions,
   checkpoints:snapshot.checkpoints
  });
 }

 snapshot(){
  if(!this.workflow)return Object.freeze({
   version:1,controlledBy:'NARA_CORE',executionBoundary:'NARA_CORE_ONLY',state:'idle',workflow:null,
   queue:Object.freeze({active:null,next:null,ready:Object.freeze([]),blocked:Object.freeze([]),verifying:null}),
   history:Object.freeze([]),checkpoints:Object.freeze([]),
   permissions:Object.freeze({required:Object.freeze([]),granted:Object.freeze([]),missing:Object.freeze([])})
  });
  const c=counts(this.workflow.steps);
  const total=Math.max(1,c.total);
  return Object.freeze({
   version:1,
   controlledBy:'NARA_CORE',
   executionBoundary:'NARA_CORE_ONLY',
   state:this.workflow.state,
   workflow:Object.freeze({
    id:this.workflow.id,goal:this.workflow.goal,mode:this.workflow.mode,state:this.workflow.state,
    createdAt:this.workflow.createdAt,startedAt:this.workflow.startedAt,finishedAt:this.workflow.finishedAt,
    lastEvent:this.workflow.lastEvent,
    progress:Math.round((c.complete/total)*100),
    counts:Object.freeze({...c}),
    order:Object.freeze([...this.workflow.order]),
    steps:Object.freeze(Object.fromEntries(this.workflow.order.map(id=>[id,Object.freeze(cloneStep(this.workflow.steps[id]))])))
   }),
   queue:this.queue(),
   history:Object.freeze([...this.history]),
   checkpoints:Object.freeze([...this.checkpoints]),
   permissions:Object.freeze({
    required:Object.freeze(this.requiredPermissions()),
    granted:Object.freeze([...this.granted]),
    missing:Object.freeze(this.missingPermissions())
   })
  });
 }
}

export function createWorkflowEngine(options){return new NaraWorkflowEngine(options);}
