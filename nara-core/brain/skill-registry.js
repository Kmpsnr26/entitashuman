const freezeSkill=value=>Object.freeze({
 ...value,
 dependencies:Object.freeze([...(value.dependencies||[])]),
 permissions:Object.freeze([...(value.permissions||[])]),
 testScenario:value.testScenario||null
});

const definitions=[
 ['hearing','Hearing','sensory','NARA_CORE',[],['sensor:read'],'listening'],
 ['voice','Voice / Speech','sensory','NARA_CORE',['hearing'],['audio:output'],'speaking'],
 ['vision','Vision','sensory','NARA_CORE',[],['camera:read'],null],
 ['memory','Memory','cognitive','MEMORY',[],['memory:read','memory:write-approved'],null],
 ['reasoning','Reasoning','cognitive','REASONER',['memory'],['state:read'],'thinking'],
 ['planner','Planner','cognitive','PLANNER',['reasoning'],['state:read'],null],
 ['agents','Agent Manager','execution','AGENT_MANAGER',['planner','terminal'],['agent:execute-approved'],null],
 ['terminal','Terminal','execution','TERMINAL',['safety'],['terminal:bounded-execute'],null],
 ['program','Program / Development','execution','PROGRAM',['terminal','safety'],['workspace:write-approved'],'processing'],
 ['bug-hunter','Bug Hunter','execution','BUG_HUNTER',['reasoning','terminal'],['diagnostic:read'],'error'],
 ['web','Web','connection','WEB',['safety'],['network:read'],null],
 ['github','GitHub','connection','GITHUB',['web','safety'],['repo:read','repo:write-approved'],null],
 ['copilot','Copilot','connection','COPILOT',['github','agents'],['agent:execute-approved'],null],
 ['drive','Drive / Cloud','connection','DRIVE',['web','memory'],['cloud:read','cloud:write-approved'],null],
 ['reporting','Reporting','workflow','REPORTING',['memory'],['report:write'],null],
 ['safety','Safety / Policy','safety','SAFETY',[],['policy:enforce'],null]
];

export const NARA_SKILLS=Object.freeze(Object.fromEntries(definitions.map(([id,label,group,region,dependencies,permissions,testScenario])=>[
 id,freezeSkill({id,label,group,region,dependencies,permissions,testScenario})
])));
export const NARA_SKILL_IDS=Object.freeze(Object.keys(NARA_SKILLS));

export function isSkillId(value){
 return typeof value==='string'&&Object.hasOwn(NARA_SKILLS,value);
}
export function getSkill(id){
 return isSkillId(id)?NARA_SKILLS[id]:null;
}
export function listSkills(group=''){
 const list=Object.values(NARA_SKILLS);
 return group?list.filter(skill=>skill.group===group):list;
}

const ACTIVE_STATUS=new Set(['active','listening','seeing','speaking','thinking','processing','syncing']);
const READY_STATUS=new Set(['ready','connected','complete']);
const ERROR_STATUS=new Set(['error','bug']);
const BLOCKED_STATUS=new Set(['login_required','paused']);
const OFFLINE_STATUS=new Set(['offline','disconnected']);

function normalizeAgentMap(agents=[]){
 return Object.fromEntries((Array.isArray(agents)?agents:[]).filter(item=>item?.id).map(item=>[item.id,item]));
}

function deriveState(skill,region,brain,agents){
 const raw=String(region?.status||'idle');

 if(skill.id==='hearing')return brain?.sensory?.hearing?.active?'running':'ready';
 if(skill.id==='voice')return brain?.sensory?.speech?.active?'running':'ready';
 if(skill.id==='vision')return brain?.sensory?.vision?.active?'running':'ready';

 if(ERROR_STATUS.has(raw))return 'error';
 if(BLOCKED_STATUS.has(raw))return 'blocked';
 if(OFFLINE_STATUS.has(raw))return 'offline';
 if(ACTIVE_STATUS.has(raw))return 'running';
 if(READY_STATUS.has(raw))return 'ready';

 if(skill.id==='agents'){
  const usable=['codex','github-copilot','cursor','claude'].some(id=>agents[id]?.canRun);
  return usable?'ready':'setup';
 }
 if(skill.id==='copilot'){
  const item=agents['github-copilot'];
  if(item?.state==='configured'||item?.canRun)return 'ready';
  if(item?.state==='installed')return 'blocked';
  return raw==='connected'?'ready':'setup';
 }
 return raw==='idle'?'ready':'setup';
}

function dependencyHealth(skill,states){
 const missing=skill.dependencies.filter(id=>!states[id]||['error','blocked','offline','setup'].includes(states[id]));
 return {ok:missing.length===0,missing};
}

export function createSkillSnapshot({brainState={},agents=[]}={}){
 const agentMap=normalizeAgentMap(agents);
 const rows={};
 for(const skill of Object.values(NARA_SKILLS)){
  const region=brainState?.regions?.[skill.region]||{};
  rows[skill.id]={
   ...skill,
   state:deriveState(skill,region,brainState,agentMap),
   regionStatus:String(region.status||'idle'),
   activity:Math.max(0,Math.min(1,Number(region.activity)||0)),
   message:String(region.message||'').slice(0,160),
   updatedAt:Number(region.updatedAt)||0
  };
 }
 const stateMap=Object.fromEntries(Object.entries(rows).map(([id,row])=>[id,row.state]));
 for(const row of Object.values(rows)){
  const dependency=dependencyHealth(row,stateMap);
  row.dependencyOk=dependency.ok;
  row.missingDependencies=dependency.missing;
  if(!dependency.ok&&row.state==='ready')row.state='blocked';
 }
 const list=Object.values(rows);
 const counts=Object.freeze({
  total:list.length,
  ready:list.filter(item=>item.state==='ready').length,
  running:list.filter(item=>item.state==='running').length,
  blocked:list.filter(item=>item.state==='blocked').length,
  error:list.filter(item=>item.state==='error').length,
  offline:list.filter(item=>item.state==='offline').length,
  setup:list.filter(item=>item.state==='setup').length
 });
 return Object.freeze({
  version:1,
  controlledBy:'NARA_CORE',
  updatedAt:Date.now(),
  counts,
  skills:Object.freeze(Object.fromEntries(list.map(item=>[item.id,Object.freeze({...item,missingDependencies:Object.freeze([...item.missingDependencies])})])))
 });
}

export function skillTestScenario(skillId){
 const skill=getSkill(skillId);
 return skill?.testScenario||null;
}


export function validateSkillDependencyGraph(){
 const visiting=new Set(),visited=new Set(),path=[];
 const visit=id=>{
  if(visiting.has(id)){
   const start=path.indexOf(id);
   return {ok:false,cycle:[...path.slice(start),id]};
  }
  if(visited.has(id))return {ok:true,cycle:[]};
  visiting.add(id);path.push(id);
  for(const dep of NARA_SKILLS[id]?.dependencies||[]){
   if(!isSkillId(dep))return {ok:false,cycle:[id,dep],error:'UNKNOWN_DEPENDENCY'};
   const result=visit(dep);
   if(!result.ok)return result;
  }
  path.pop();visiting.delete(id);visited.add(id);
  return {ok:true,cycle:[]};
 };
 for(const id of NARA_SKILL_IDS){
  const result=visit(id);
  if(!result.ok)return Object.freeze(result);
 }
 return Object.freeze({ok:true,cycle:[]});
}
