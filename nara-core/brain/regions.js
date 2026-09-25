const position=(x,y,z)=>Object.freeze({x,y,z});
const freezeRegion=value=>Object.freeze({...value,position:Object.freeze(value.position),connections:Object.freeze([...value.connections])});

export const NARA_REGION_STATUS=Object.freeze([
  'offline','idle','ready','active','listening','seeing','speaking','thinking',
  'processing','connected','disconnected','syncing','login_required','error',
  'bug','complete','paused'
]);

const definitions=[
  ['NARA_CORE','NARA Core','core',position(0,0.08,0.18),['REASONER','PLANNER','MEMORY','AGENT_MANAGER','SAFETY','FOLLOW_UP']],
  ['REASONER','Reasoner','cognitive',position(-0.34,0.02,0.10),['NARA_CORE','BUG_HUNTER','MEMORY']],
  ['PLANNER','Planner','cognitive',position(0.34,0.02,0.10),['NARA_CORE','AGENT_MANAGER','FOLLOW_UP']],
  ['MEMORY','Memory','cognitive',position(-0.42,-0.18,0.02),['NARA_CORE','REASONER','DRIVE']],
  ['BUG_HUNTER','Bug Hunter','cognitive',position(-0.18,-0.28,0.16),['REASONER','ERROR_MONITOR','PROGRAM','REPORTING']],
  ['AGENT_MANAGER','Agent Manager','cognitive',position(0.18,-0.28,0.16),['NARA_CORE','TOOLS','PROGRAM','TEAM']],
  ['TOOLS','Tools','execution',position(0.46,-0.16,0.02),['AGENT_MANAGER','TERMINAL','WEB','DRIVE']],
  ['TERMINAL','Terminal','execution',position(0.54,-0.38,-0.02),['TOOLS','PROGRAM','ERROR_MONITOR']],
  ['PROGRAM','Program','execution',position(0.24,-0.48,0.04),['TERMINAL','BUG_HUNTER','FOLLOW_UP','REPORTING']],
  ['ERROR_MONITOR','Error Monitor','execution',position(-0.12,-0.50,0.02),['BUG_HUNTER','TERMINAL','REPORTING']],
  ['GITHUB','GitHub','connection',position(-0.60,0.16,-0.04),['PR','SYNC','COPILOT','TEAM']],
  ['COPILOT','Copilot','connection',position(-0.58,-0.06,-0.05),['GITHUB','AGENT_MANAGER','PROGRAM']],
  ['WEB','Web','connection',position(0.60,0.18,-0.05),['TOOLS','ONLINE','NARA_CORE']],
  ['TEAM','Team','connection',position(-0.52,0.38,-0.10),['GITHUB','PR','AGENT_MANAGER']],
  ['PR','Pull Request','connection',position(-0.30,0.46,-0.12),['GITHUB','TEAM','REPORTING']],
  ['SYNC','Synchronization','connection',position(0.00,0.50,-0.13),['GITHUB','DRIVE','MEMORY','ONLINE']],
  ['ONLINE','Online','connection',position(0.30,0.46,-0.12),['WEB','SYNC','NARA_CORE']],
  ['OWNER_EMAIL','Email Pemilik','connection',position(0.56,0.38,-0.10),['FOLLOW_UP','REPORTING','NARA_CORE']],
  ['DRIVE','Drive','connection',position(0.62,-0.04,-0.06),['MEMORY','SYNC','TOOLS','REPORTING']],
  ['REPORTING','Laporan','workflow',position(-0.34,-0.46,-0.04),['BUG_HUNTER','PROGRAM','FOLLOW_UP','OWNER_EMAIL']],
  ['FOLLOW_UP','Tindak Lanjut','workflow',position(0.00,-0.38,0.24),['NARA_CORE','PLANNER','PROGRAM','REPORTING','OWNER_EMAIL']],
  ['SAFETY','Safety','safety',position(0,0.28,-0.20),['NARA_CORE','TOOLS','TERMINAL','GITHUB','OWNER_EMAIL']]
];

export const NARA_REGIONS=Object.freeze(Object.fromEntries(definitions.map(([id,label,group,pos,connections])=>[
  id,
  freezeRegion({id,label,group,position:pos,connections,defaultStatus:id==='NARA_CORE'?'ready':'idle'})
])));

export const NARA_REGION_IDS=Object.freeze(Object.keys(NARA_REGIONS));

export function isRegionId(value){return typeof value==='string'&&Object.hasOwn(NARA_REGIONS,value);}
export function getRegion(id){return isRegionId(id)?NARA_REGIONS[id]:null;}
export function listRegions(group=''){const values=Object.values(NARA_REGIONS);return group?values.filter(region=>region.group===group):values;}
