const position=(x,y,z)=>Object.freeze({x,y,z});
const freezeRegion=value=>Object.freeze({...value,position:Object.freeze(value.position),connections:Object.freeze([...value.connections])});

export const ALECORE_AI_REGION_STATUS=Object.freeze([
  'offline','idle','ready','active','listening','seeing','speaking','thinking',
  'processing','connected','disconnected','syncing','login_required','error',
  'bug','complete','paused'
]);

const definitions=[
  ['ALECORE_AI','AleCore AI','core',position(0,0.08,0.18),['REASONER','PLANNER','MEMORY','AGENT_MANAGER','SAFETY','FOLLOW_UP']],
  ['REASONER','Reasoner','cognitive',position(-0.34,0.02,0.10),['ALECORE_AI','BUG_HUNTER','MEMORY']],
  ['PLANNER','Planner','cognitive',position(0.34,0.02,0.10),['ALECORE_AI','AGENT_MANAGER','FOLLOW_UP']],
  ['MEMORY','Memory','cognitive',position(-0.42,-0.18,0.02),['ALECORE_AI','REASONER','DRIVE']],
  ['BUG_HUNTER','Bug Hunter','cognitive',position(-0.18,-0.28,0.16),['REASONER','ERROR_MONITOR','PROGRAM','REPORTING']],
  ['AGENT_MANAGER','Agent Manager','cognitive',position(0.18,-0.28,0.16),['ALECORE_AI','TOOLS','PROGRAM','TEAM']],
  ['TOOLS','Tools','execution',position(0.46,-0.16,0.02),['AGENT_MANAGER','TERMINAL','WEB','DRIVE']],
  ['TERMINAL','Terminal','execution',position(0.54,-0.38,-0.02),['TOOLS','PROGRAM','ERROR_MONITOR']],
  ['PROGRAM','Program','execution',position(0.24,-0.48,0.04),['TERMINAL','BUG_HUNTER','FOLLOW_UP','REPORTING']],
  ['ERROR_MONITOR','Error Monitor','execution',position(-0.12,-0.50,0.02),['BUG_HUNTER','TERMINAL','REPORTING']],
  ['GITHUB','GitHub','connection',position(-0.60,0.16,-0.04),['PR','SYNC','COPILOT','TEAM']],
  ['COPILOT','Copilot','connection',position(-0.58,-0.06,-0.05),['GITHUB','AGENT_MANAGER','PROGRAM']],
  ['WEB','Web','connection',position(0.60,0.18,-0.05),['TOOLS','ONLINE','ALECORE_AI']],
  ['TEAM','Team','connection',position(-0.52,0.38,-0.10),['GITHUB','PR','AGENT_MANAGER']],
  ['PR','Pull Request','connection',position(-0.30,0.46,-0.12),['GITHUB','TEAM','REPORTING']],
  ['SYNC','Synchronization','connection',position(0.00,0.50,-0.13),['GITHUB','DRIVE','MEMORY','ONLINE']],
  ['ONLINE','Online','connection',position(0.30,0.46,-0.12),['WEB','SYNC','ALECORE_AI']],
  ['OWNER_EMAIL','Email Pemilik','connection',position(0.56,0.38,-0.10),['FOLLOW_UP','REPORTING','ALECORE_AI']],
  ['DRIVE','Drive','connection',position(0.62,-0.04,-0.06),['MEMORY','SYNC','TOOLS','REPORTING']],
  ['REPORTING','Laporan','workflow',position(-0.34,-0.46,-0.04),['BUG_HUNTER','PROGRAM','FOLLOW_UP','OWNER_EMAIL']],
  ['FOLLOW_UP','Tindak Lanjut','workflow',position(0.00,-0.38,0.24),['ALECORE_AI','PLANNER','PROGRAM','REPORTING','OWNER_EMAIL']],
  ['SAFETY','Safety','safety',position(0,0.28,-0.20),['ALECORE_AI','TOOLS','TERMINAL','GITHUB','OWNER_EMAIL']]
];

export const ALECORE_AI_REGIONS=Object.freeze(Object.fromEntries(definitions.map(([id,label,group,pos,connections])=>[
  id,
  freezeRegion({id,label,group,position:pos,connections,defaultStatus:id==='ALECORE_AI'?'ready':'idle'})
])));

export const ALECORE_AI_REGION_IDS=Object.freeze(Object.keys(ALECORE_AI_REGIONS));

export function isRegionId(value){return typeof value==='string'&&Object.hasOwn(ALECORE_AI_REGIONS,value);}
export function getRegion(id){return isRegionId(id)?ALECORE_AI_REGIONS[id]:null;}
export function listRegions(group=''){const values=Object.values(ALECORE_AI_REGIONS);return group?values.filter(region=>region.group===group):values;}
