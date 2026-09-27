import {posix as pathPosix} from 'node:path';

export const AI_MAINTENANCE_GUARD_VERSION='1.0.0';

export const AI_MAINTENANCE_MAX_CHANGED_FILES=32;
export const AI_MAINTENANCE_MAX_CHANGED_BYTES=2*1024*1024;

export const AI_MAINTENANCE_SENSITIVE_ENV_PATTERN=
 /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|AUTHORIZATION|COOKIE|CREDENTIALS?|PRIVATE_KEY|CLIENT_SECRET|REFRESH_TOKEN|ACCESS_KEY|PEPPER|SIGNING|KEYSTORE|CERTIFICATE)(?:_|$)|DATABASE_URL|SSH_AUTH_SOCK|SSH_AGENT_PID|GPG_AGENT_INFO|GOOGLE_APPLICATION_CREDENTIALS|DOCKER_AUTH_CONFIG|NPM_CONFIG__AUTH/i;

const PATCH_DENY_RULES=Object.freeze([
 Object.freeze({
  code:'SECRET_ENV_ACCESS_ADDED',
  pattern:/\bprocess\.env(?:\s*\.\s*|\s*\[\s*['"])(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|AUTHORIZATION|COOKIE|CREDENTIALS?|PRIVATE_KEY|CLIENT_SECRET|REFRESH_TOKEN|ACCESS_KEY|PEPPER|SIGNING|KEYSTORE|CERTIFICATE)|DATABASE_URL)\b/i
 }),
 Object.freeze({
  code:'OWNER_DATABASE_MUTATION_ADDED',
  pattern:/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+owner_users\b/i
 }),
 Object.freeze({
  code:'CREATOR_APPROVAL_MUTATION_ADDED',
  pattern:/\bcreatorApproval\b[^\n]{0,120}\bapproved\s*[:=]\s*true\b/i
 }),
 Object.freeze({
  code:'FINAL_INTEGRATION_UNLOCK_ADDED',
  pattern:/\bintegrationUnlocked\s*[:=]\s*true\b/i
 }),
 Object.freeze({
  code:'RELEASE_AUTHORITY_COMMAND_ADDED',
  pattern:/\b(?:git\s+push|git\s+merge|gh\s+release|npm\s+publish|publish\s+release)\b/i
 })
]);

function escapeRegExp(value){
 return value.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
}

function globToRegExp(pattern){
 const input=normalizeMaintenanceRepoPath(pattern,{allowGlob:true});
 let out='^';
 for(let i=0;i<input.length;i++){
  const char=input[i];
  if(char==='*'){
   if(input[i+1]==='*'){
    i++;
    if(input[i+1]==='/'){
     i++;
     out+='(?:.*/)?';
    }else out+='.*';
   }else out+='[^/]*';
  }else if(char==='?'){
   out+='[^/]';
  }else{
   out+=escapeRegExp(char);
  }
 }
 out+='$';
 return new RegExp(out,'i');
}

export function normalizeMaintenanceRepoPath(value,{allowGlob=false}={}){
 const raw=String(value??'').replace(/\\/g,'/').trim();
 if(!raw||raw.includes('\0'))throw new Error('Maintenance path tidak valid.');
 if(/^\/?[A-Za-z]:\//.test(raw)||raw.startsWith('/')||raw.startsWith('//')){
  throw new Error('Maintenance path harus relatif terhadap repository.');
 }
 const normalized=pathPosix.normalize(raw);
 if(normalized==='.'||normalized==='..'||normalized.startsWith('../')||normalized.includes('/../')){
  throw new Error('Maintenance path keluar dari repository.');
 }
 if(!allowGlob&&/[?*]/.test(normalized)){
  throw new Error('Maintenance runtime path tidak boleh mengandung glob.');
 }
 return normalized.replace(/^\.\//,'');
}

export function sanitizeMaintenanceEnvironment(baseEnv={}){
 const output={};
 const removed=[];
 for(const [rawKey,rawValue] of Object.entries(baseEnv||{})){
  const key=String(rawKey);
  if(AI_MAINTENANCE_SENSITIVE_ENV_PATTERN.test(key)){
   removed.push(key);
   continue;
  }
  if(rawValue===undefined||rawValue===null)continue;
  output[key]=String(rawValue);
 }
 output.NO_COLOR='1';
 return Object.freeze({
  env:Object.freeze({...output}),
  removed:Object.freeze(removed.sort())
 });
}

export function isMaintenanceProtectedPath(path,protectedAreas=[]){
 const normalized=normalizeMaintenanceRepoPath(path);
 return (protectedAreas||[]).some(pattern=>globToRegExp(pattern).test(normalized));
}

export function isMaintenanceReadDeniedPath(path,readDeniedAreas=[]){
 const normalized=normalizeMaintenanceRepoPath(path);
 const basename=normalized.split('/').at(-1)?.toLowerCase()||'';
 if(['.env.example','.env.sample','.env.template'].includes(basename))return false;
 return (readDeniedAreas||[]).some(pattern=>globToRegExp(pattern).test(normalized));
}

export function extractAddedPatchLines(patch=''){
 const added=[];
 for(const rawLine of String(patch??'').split(/\r?\n/)){
  if(!rawLine.startsWith('+')||rawLine.startsWith('+++'))continue;
  added.push(rawLine.slice(1));
 }
 return added.join('\n');
}

export function inspectMaintenancePatchText(patch=''){
 const added=extractAddedPatchLines(patch);
 const violations=[];
 for(const rule of PATCH_DENY_RULES){
  if(rule.pattern.test(added))violations.push(rule.code);
 }
 return Object.freeze({
  allowed:violations.length===0,
  violations:Object.freeze(violations),
  addedTextBytes:Buffer.byteLength(added,'utf8')
 });
}

export function evaluateMaintenanceChangeSet({
 paths=[],
 protectedAreas=[],
 symlinkPaths=[],
 stagedPaths=[],
 totalBytes=0,
 branchChanged=false,
 headChanged=false,
 gitMetadataChanged=false,
 lockChanged=false,
 patch=''
}={}){
 const normalizedPaths=[...new Set((paths||[]).map(path=>normalizeMaintenanceRepoPath(path)))];
 const normalizedSymlinks=[...new Set((symlinkPaths||[]).map(path=>normalizeMaintenanceRepoPath(path)))];
 const normalizedStaged=[...new Set((stagedPaths||[]).map(path=>normalizeMaintenanceRepoPath(path)))];
 const protectedPaths=normalizedPaths.filter(path=>isMaintenanceProtectedPath(path,protectedAreas));
 const patchInspection=inspectMaintenancePatchText(patch);
 const violations=[];

 if(branchChanged)violations.push('BRANCH_DRIFT');
 if(headChanged)violations.push('HEAD_DRIFT');
 if(gitMetadataChanged)violations.push('GIT_METADATA_DRIFT');
 if(lockChanged)violations.push('REPO_LOCK_DRIFT');
 if(normalizedStaged.length)violations.push('STAGED_CHANGE');
 if(normalizedSymlinks.length)violations.push('SYMLINK_CHANGE');
 if(protectedPaths.length)violations.push('PROTECTED_PATH_CHANGE');
 if(normalizedPaths.length>AI_MAINTENANCE_MAX_CHANGED_FILES)violations.push('TOO_MANY_CHANGED_FILES');
 if(!Number.isFinite(totalBytes)||totalBytes<0||totalBytes>AI_MAINTENANCE_MAX_CHANGED_BYTES){
  violations.push('CHANGESET_TOO_LARGE');
 }
 violations.push(...patchInspection.violations);

 return Object.freeze({
  allowed:violations.length===0,
  violations:Object.freeze([...new Set(violations)]),
  paths:Object.freeze(normalizedPaths),
  protectedPaths:Object.freeze(protectedPaths),
  symlinkPaths:Object.freeze(normalizedSymlinks),
  stagedPaths:Object.freeze(normalizedStaged),
  totalBytes,
  patch:Object.freeze({
   allowed:patchInspection.allowed,
   violations:patchInspection.violations,
   addedTextBytes:patchInspection.addedTextBytes
  })
 });
}
