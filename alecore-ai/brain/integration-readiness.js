const freeze=value=>Object.freeze(value);

export const ALECORE_AI_READINESS_LIMITS=freeze({
 maxChecks:24,
 maxBlockers:24,
 maxWarnings:24
});

export const ALECORE_AI_CRITICAL_SKILLS=freeze([
 'safety','reasoning','planner','memory','reporting','hearing','voice','vision'
]);

const badSkillStates=new Set(['error','offline','setup','blocked']);
const activeWorkflowStates=new Set(['planned','running','blocked','verifying','failed']);

function boundedList(values,max=ALECORE_AI_READINESS_LIMITS.maxBlockers){
 return freeze([...new Set(values.map(value=>String(value||'').slice(0,120)).filter(Boolean))].slice(0,max));
}

function check(id,ok,detail=''){
 return freeze({id:String(id),ok:Boolean(ok),detail:String(detail||'').slice(0,180)});
}

export function evaluateAleIntegrationReadiness({
 brainState={},
 skillSnapshot={},
 workflowSnapshot={},
 authoritySnapshot={}
}={}){
 const checks=[],blockers=[],warnings=[];
 const add=(id,ok,detail,blocker='')=>{
  checks.push(check(id,ok,detail));
  if(!ok&&blocker)blockers.push(blocker);
 };

 const lifecycle=String(brainState?.lifecycle||'idle');
 add('core.lifecycle',lifecycle==='active','lifecycle='+lifecycle,'core:lifecycle-not-active');

 const controlledBy=String(brainState?.humanale?.controlledBy||'');
 add('core.humanale-authority',controlledBy==='ALECORE_AI','controlledBy='+(controlledBy||'unknown'),'core:humanale-authority');

 const currentTask=brainState?.currentTask;
 add('core.no-active-task',!currentTask,currentTask?.label||'idle','core:active-task');

 const errorRegions=Object.values(brainState?.regions||{}).filter(region=>['error','bug'].includes(region?.status)).map(region=>region.id);
 add('core.no-error-regions',errorRegions.length===0,errorRegions.join(', ')||'none','core:error-regions');

 const workflowState=String(workflowSnapshot?.state||workflowSnapshot?.workflow?.state||'idle');
 const workflowClear=!activeWorkflowStates.has(workflowState);
 add('workflow.clear',workflowClear,'state='+workflowState,'workflow:not-clear');

 const directive=authoritySnapshot?.creatorDirective||{};
 add(
  'authority.creator-directive',
  directive.integrationPolicy==='FINAL_INTEGRATION_ONLY'&&directive.workflowAuthority==='ALECORE_AI',
  String(directive.integrationPolicy||'missing')+' / '+String(directive.workflowAuthority||'missing'),
  'authority:creator-directive'
 );

 const phase=String(authoritySnapshot?.phase||'development');
 const integrationLocked=authoritySnapshot?.integrationLocked!==false;
 const phaseAllowed=['development','validation','final-integration','released'].includes(phase);
 add('authority.phase-known',phaseAllowed,'phase='+phase,'authority:unknown-phase');

 if(['development','validation'].includes(phase)){
  add('authority.pre-final-lock',integrationLocked,'integrationLocked='+integrationLocked,'authority:bridge-unlocked-too-early');
  const bridge=authoritySnapshot?.bridge||{};
  const prematureOpen=Object.entries(bridge).filter(([,decision])=>decision?.decision!=='block').map(([name])=>name);
  add('authority.bridge-locked',prematureOpen.length===0,prematureOpen.join(', ')||'all blocked','authority:bridge-open-too-early');
 }else{
  add('authority.final-approved',authoritySnapshot?.finalIntegrationApproved===true,'approved='+Boolean(authoritySnapshot?.finalIntegrationApproved),'authority:final-not-approved');
 }

 const skills=skillSnapshot?.skills||{};
 for(const id of ALECORE_AI_CRITICAL_SKILLS){
  const skill=skills[id];
  const state=String(skill?.state||'missing');
  const ok=Boolean(skill)&&!badSkillStates.has(state);
  add('skill.'+id,ok,state,ok?'':'skill:'+id+':'+state);
 }

 const optionalIssues=Object.values(skills)
  .filter(skill=>skill&&!ALECORE_AI_CRITICAL_SKILLS.includes(skill.id)&&badSkillStates.has(String(skill.state||'')))
  .map(skill=>'skill:'+skill.id+':'+skill.state);
 warnings.push(...optionalIssues);

 const boundedChecks=freeze(checks.slice(0,ALECORE_AI_READINESS_LIMITS.maxChecks));
 const boundedBlockers=boundedList(blockers);
 const boundedWarnings=boundedList(warnings,ALECORE_AI_READINESS_LIMITS.maxWarnings);

 let status='blocked';
 if(!boundedBlockers.length){
  if(['final-integration','released'].includes(phase)&&authoritySnapshot?.finalIntegrationApproved===true){
   status='final-integration-approved';
  }else if(phase==='validation'){
   status='ready-for-creator-confirmation';
  }else{
   status='development-ready';
  }
 }

 return freeze({
  version:1,
  controlledBy:'ALECORE_AI',
  integrationBoundary:'LOCKED_UNTIL_CREATOR_FINAL_CONFIRMATION',
  status,
  phase,
  readyForCreatorConfirmation:status==='ready-for-creator-confirmation',
  finalIntegrationApproved:status==='final-integration-approved',
  counts:freeze({
   checks:boundedChecks.length,
   passed:boundedChecks.filter(item=>item.ok).length,
   failed:boundedChecks.filter(item=>!item.ok).length,
   blockers:boundedBlockers.length,
   warnings:boundedWarnings.length
  }),
  blockers:boundedBlockers,
  warnings:boundedWarnings,
  checks:boundedChecks
 });
}

export function readinessCertificate(input={}){
 const result=evaluateAleIntegrationReadiness(input);
 return freeze({
  version:1,
  controlledBy:'ALECORE_AI',
  integrationBoundary:result.integrationBoundary,
  status:result.status,
  phase:result.phase,
  readyForCreatorConfirmation:result.readyForCreatorConfirmation,
  finalIntegrationApproved:result.finalIntegrationApproved,
  passed:result.readyForCreatorConfirmation||result.finalIntegrationApproved,
  blockers:result.blockers,
  warnings:result.warnings
 });
}
