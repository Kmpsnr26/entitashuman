import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {
 mkdir,mkdtemp,open,readFile,realpath,readdir,lstat,readlink,rename,rm,stat
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {
 AI_MAINTENANCE_PROTECTED_AREAS,
 AI_MAINTENANCE_READ_DENIED_AREAS
} from './agent-maintenance-policy.mjs';
import {
 evaluateMaintenanceChangeSet,
 isMaintenanceReadDeniedPath,
 normalizeMaintenanceRepoPath,
 sanitizeMaintenanceEnvironment
} from './agent-maintenance-guard.mjs';

export const AI_MAINTENANCE_TRANSACTION_VERSION='1.1.0';
export const AI_MAINTENANCE_LOCK_FILE='humanale-ai-maintenance.lock';

const SECRET_SCAN_SKIP_DIRS=new Set([
 '.git','node_modules','dist','build','out','coverage','.next','.vite'
]);

function normalizedOsPath(value){
 const resolved=resolve(String(value||''));
 return process.platform==='win32'?resolved.toLowerCase():resolved;
}

function sha256(value){
 return createHash('sha256').update(value).digest('hex');
}

async function runGit(cwd,args,{timeout=12000,maxOutput=8*1024*1024}={}){
 const safeEnv=sanitizeMaintenanceEnvironment(process.env).env;
 return await new Promise((resolvePromise,reject)=>{
  const child=spawn('git',args,{
   cwd,
   windowsHide:true,
   stdio:['ignore','pipe','pipe'],
   env:{...safeEnv,NO_COLOR:'1'}
  });
  let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   error?reject(error):resolvePromise(value);
  };
  const timer=setTimeout(()=>{
   child.kill();
   finish(new Error('Git maintenance command timeout: '+args.join(' ')));
  },timeout);
  child.stdout.on('data',data=>{
   stdout+=data;
   if(Buffer.byteLength(stdout,'utf8')>maxOutput){
    child.kill();
    finish(new Error('Git maintenance output terlalu besar.'));
   }
  });
  child.stderr.on('data',data=>{
   stderr=(stderr+data).slice(-32000);
  });
  child.on('error',error=>finish(error));
  child.on('close',code=>{
   if(code===0)return finish(null,{stdout,stderr,code});
   finish(new Error('Git maintenance command gagal: git '+args.join(' ')+'\n'+stderr.trim()));
  });
 });
}

async function gitText(cwd,args,options){
 return (await runGit(cwd,args,options)).stdout.trim();
}

async function fileFingerprint(path){
 try{
  const info=await lstat(path);
  if(info.isSymbolicLink()){
   return 'link:'+await readlink(path);
  }
  if(info.isDirectory()){
   const entries=(await readdir(path,{withFileTypes:true}))
    .sort((a,b)=>a.name.localeCompare(b.name));
   const parts=[];
   for(const entry of entries){
    parts.push(entry.name+':'+await fileFingerprint(join(path,entry.name)));
   }
   return 'dir:'+sha256(parts.join('\n'));
  }
  if(info.isFile()){
   return 'file:'+sha256(await readFile(path));
  }
  return 'other:'+String(info.mode);
 }catch(error){
  if(error?.code==='ENOENT')return 'missing';
  throw error;
 }
}

async function gitMetadataFingerprint(cwd){
 const config=await gitText(cwd,['config','--local','--list','--show-origin','-z']);
 const hooksRaw=await gitText(cwd,['rev-parse','--git-path','hooks']);
 const excludeRaw=await gitText(cwd,['rev-parse','--git-path','info/exclude']);
 const attributesRaw=await gitText(cwd,['rev-parse','--git-path','info/attributes']);
 const toPath=value=>resolve(cwd,value);
 const parts=[
  'config:'+sha256(config),
  'hooks:'+await fileFingerprint(toPath(hooksRaw)),
  'exclude:'+await fileFingerprint(toPath(excludeRaw)),
  'attributes:'+await fileFingerprint(toPath(attributesRaw))
 ];
 return sha256(parts.join('\n'));
}

async function scanRepositorySymlinks(root,{limit=20}={}){
 const hits=[];
 async function walk(dir,relative=''){
  if(hits.length>=limit)return;
  let entries;
  try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   if(hits.length>=limit)return;
   if(entry.name==='.git')continue;
   const rel=relative?relative+'/'+entry.name:entry.name;
   let normalized;
   try{normalized=normalizeMaintenanceRepoPath(rel);}catch{continue;}
   const absolute=join(dir,entry.name);
   try{
    const info=await lstat(absolute);
    if(info.isSymbolicLink()){
     hits.push(normalized);
     continue;
    }
    if(info.isDirectory()&&!SECRET_SCAN_SKIP_DIRS.has(entry.name)){
     await walk(absolute,normalized);
    }
   }catch{}
  }
 }
 await walk(root);
 return hits;
}

async function scanSecretFiles(root,{limit=20}={}){
 const hits=[];
 async function walk(dir,relative=''){
  if(hits.length>=limit)return;
  let entries;
  try{
   entries=await readdir(dir,{withFileTypes:true});
  }catch{return;}
  for(const entry of entries){
   if(hits.length>=limit)return;
   if(entry.isDirectory()&&SECRET_SCAN_SKIP_DIRS.has(entry.name))continue;
   const rel=relative?relative+'/'+entry.name:entry.name;
   let normalized;
   try{normalized=normalizeMaintenanceRepoPath(rel);}catch{continue;}
   if(isMaintenanceReadDeniedPath(normalized,AI_MAINTENANCE_READ_DENIED_AREAS)){
    hits.push(normalized);
    continue;
   }
   if(entry.isDirectory()&&!entry.isSymbolicLink()){
    await walk(join(dir,entry.name),normalized);
   }
  }
 }
 await walk(root);
 return hits;
}

export function parseMaintenancePorcelainZ(value=''){
 const fields=String(value??'').split('\0');
 const entries=[];
 for(let index=0;index<fields.length;index++){
  const record=fields[index];
  if(!record)continue;
  if(record.length<3)throw new Error('Git porcelain record tidak valid.');
  const status=record.slice(0,2);
  const path=normalizeMaintenanceRepoPath(record.slice(3));
  const paths=[path];
  if(/[RC]/.test(status)&&fields[index+1]){
   paths.push(normalizeMaintenanceRepoPath(fields[++index]));
  }
  entries.push(Object.freeze({
   status,
   paths:Object.freeze(paths),
   untracked:status==='??'
  }));
 }
 return Object.freeze(entries);
}

function changedPathsFromEntries(entries){
 return [...new Set(entries.flatMap(entry=>entry.paths))];
}

async function acquireLock(gitDir,{baseHead,baseBranch}){
 const lockPath=join(gitDir,AI_MAINTENANCE_LOCK_FILE);
 const token=randomUUID();
 let handle;
 try{
  handle=await open(lockPath,'wx',0o600);
 }catch(error){
  if(error?.code==='EEXIST'){
   const lockError=new Error('Repository sedang dikunci oleh maintenance transaction lain.');
   lockError.code='AI_MAINTENANCE_REPO_LOCKED';
   throw lockError;
  }
  throw error;
 }
 const payload={
  version:AI_MAINTENANCE_TRANSACTION_VERSION,
  token,
  pid:process.pid,
  startedAt:Date.now(),
  baseHead,
  baseBranch
 };
 await handle.writeFile(JSON.stringify(payload,null,2)+'\n','utf8');
 await handle.close();
 return {lockPath,lockToken:token};
}

async function lockMatches(transaction){
 try{
  const data=JSON.parse(await readFile(transaction.lockPath,'utf8'));
  return data?.token===transaction.lockToken;
 }catch{
  return false;
 }
}

async function releaseLock(transaction){
 if(!transaction?.lockPath)return;
 if(!await lockMatches(transaction))return;
 await rm(transaction.lockPath,{force:true});
}

function isProtectedBranch(branch){
 return /^(?:main|master)$/i.test(branch)||
  /^release(?:\/|-)/i.test(branch)||
  /^codex\/release-/i.test(branch);
}

async function beginTransaction(cwd){
 const requestedRoot=await realpath(cwd);
 const gitRootRaw=await gitText(requestedRoot,['rev-parse','--show-toplevel']);
 const gitRoot=await realpath(gitRootRaw);
 if(normalizedOsPath(requestedRoot)!==normalizedOsPath(gitRoot)){
  const error=new Error('AI maintenance harus dijalankan dari root repository Git.');
  error.code='AI_MAINTENANCE_ROOT_MISMATCH';
  throw error;
 }

 const baseHead=await gitText(gitRoot,['rev-parse','HEAD']);
 const baseBranch=await gitText(gitRoot,['branch','--show-current']);
 if(!baseBranch){
  const error=new Error('AI maintenance tidak boleh berjalan pada detached HEAD.');
  error.code='AI_MAINTENANCE_DETACHED_HEAD';
  throw error;
 }
 if(isProtectedBranch(baseBranch)){
  const error=new Error('AI maintenance tidak boleh menulis langsung pada branch dilindungi: '+baseBranch);
  error.code='AI_MAINTENANCE_PROTECTED_BRANCH';
  throw error;
 }

 const gitDirRaw=await gitText(gitRoot,['rev-parse','--git-dir']);
 const gitDir=resolve(gitRoot,gitDirRaw);
 const lock=await acquireLock(gitDir,{baseHead,baseBranch});
 let transaction;
 try{
  const status=await gitText(gitRoot,['status','--porcelain=v1','-z','--untracked-files=all']);
  if(status){
   const error=new Error('AI maintenance hanya boleh dimulai dari Git worktree bersih.');
   error.code='AI_MAINTENANCE_DIRTY_WORKTREE';
   throw error;
  }

  const secretFiles=await scanSecretFiles(gitRoot);
  if(secretFiles.length){
   const error=new Error('AI maintenance diblokir karena checkout mengandung file secret lokal: '+secretFiles.join(', '));
   error.code='AI_MAINTENANCE_SECRET_FILE_PRESENT';
   error.paths=secretFiles;
   throw error;
  }

  const baselineSymlinks=await scanRepositorySymlinks(gitRoot);
  if(baselineSymlinks.length){
   const error=new Error('AI maintenance diblokir karena repository mengandung symbolic link: '+baselineSymlinks.join(', '));
   error.code='AI_MAINTENANCE_BASELINE_SYMLINK_PRESENT';
   error.paths=baselineSymlinks;
   throw error;
  }

  const isolatedHome=await mkdtemp(join(tmpdir(),'humanale-ai-home-'));

  transaction={
   id:'maintenance-'+randomUUID(),
   version:AI_MAINTENANCE_TRANSACTION_VERSION,
   cwd:gitRoot,
   gitDir,
   baseHead,
   baseBranch,
   gitMetadataHash:await gitMetadataFingerprint(gitRoot),
   startedAt:Date.now(),
   isolatedHome,
   ...lock,
   released:false
  };
  return transaction;
 }catch(error){
  await releaseLock({...lock});
  throw error;
 }
}

async function appendUntrackedPatch(cwd,entries,patch){
 let output=String(patch||'');
 for(const entry of entries.filter(item=>item.untracked)){
  for(const path of entry.paths){
   const absolute=join(cwd,path);
   try{
    const info=await lstat(absolute);
    if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)continue;
    const data=await readFile(absolute);
    if(data.includes(0))continue;
    const text=data.toString('utf8');
    output+='\n--- /dev/null\n+++ b/'+path+'\n';
    output+=text.split(/\r?\n/).map(line=>'+'+line).join('\n');
   }catch{}
  }
 }
 return output;
}

async function collectChangeSet(transaction){
 const cwd=transaction.cwd;
 const statusRaw=(await runGit(cwd,['status','--porcelain=v1','-z','--untracked-files=all'])).stdout;
 const entries=parseMaintenancePorcelainZ(statusRaw);
 const paths=changedPathsFromEntries(entries);
 const stagedRaw=(await runGit(cwd,['diff','--cached','--name-only','-z'])).stdout;
 const stagedPaths=stagedRaw.split('\0').filter(Boolean).map(path=>normalizeMaintenanceRepoPath(path));
 const symlinkPaths=[];
 const secretFiles=await scanSecretFiles(cwd);
 let totalBytes=0;
 for(const path of paths){
  try{
   const info=await lstat(join(cwd,path));
   if(info.isSymbolicLink())symlinkPaths.push(path);
   else if(info.isFile())totalBytes+=info.size;
  }catch{}
 }
 let patch=(await runGit(cwd,['diff','--no-ext-diff','--unified=0',transaction.baseHead,'--'])).stdout;
 patch=await appendUntrackedPatch(cwd,entries,patch);
 const branch=await gitText(cwd,['branch','--show-current']);
 const head=await gitText(cwd,['rev-parse','HEAD']);
 const metadataHash=await gitMetadataFingerprint(cwd);
 const lockChanged=!await lockMatches(transaction);

 return {
  entries,
  paths,
  stagedPaths,
  symlinkPaths,
  secretFiles,
  totalBytes,
  patch,
  branchChanged:branch!==transaction.baseBranch,
  headChanged:head!==transaction.baseHead,
  gitMetadataChanged:metadataHash!==transaction.gitMetadataHash,
  lockChanged
 };
}

async function quarantineAndRollback(transaction,changeSet){
 const cwd=transaction.cwd;
 const quarantine=join(transaction.gitDir,'humanale-maintenance-quarantine',transaction.id);
 await mkdir(quarantine,{recursive:true});
 const trackedPatch=(await runGit(cwd,['diff','--binary',transaction.baseHead,'--'])).stdout;
 await mkdir(dirname(join(quarantine,'tracked.patch')),{recursive:true});
 const patchHandle=await open(join(quarantine,'tracked.patch'),'w',0o600);
 await patchHandle.writeFile(trackedPatch,'utf8');
 await patchHandle.close();

 const untracked=[...new Set([
  ...changeSet.entries.filter(entry=>entry.untracked).flatMap(entry=>entry.paths),
  ...(changeSet.secretFiles||[])
 ])];
 for(const path of untracked){
  const source=join(cwd,path);
  const target=join(quarantine,'untracked',path);
  try{
   await mkdir(dirname(target),{recursive:true});
   await rename(source,target);
  }catch(error){
   if(error?.code!=='ENOENT')throw error;
  }
 }

 await runGit(cwd,['restore','--source',transaction.baseHead,'--staged','--worktree','--','.']);
 const remaining=await gitText(cwd,['status','--porcelain=v1','-z','--untracked-files=all']);
 const remainingSecrets=await scanSecretFiles(cwd);
 if(remaining||remainingSecrets.length){
  const error=new Error('Rollback AI maintenance tidak kembali ke worktree bersih atau masih menyisakan file secret.');
  error.code='AI_MAINTENANCE_ROLLBACK_INCOMPLETE';
  throw error;
 }
 return quarantine;
}

export class MaintenanceTransaction{
 constructor(state){
  Object.assign(this,state);
 }

 static async begin(cwd){
  return new MaintenanceTransaction(await beginTransaction(cwd));
 }

 async inspect({rollbackOnViolation=true}={}){
  if(this.released)throw new Error('Maintenance transaction sudah dilepas.');
  const changeSet=await collectChangeSet(this);
  const result=evaluateMaintenanceChangeSet({
   paths:changeSet.paths,
   protectedAreas:AI_MAINTENANCE_PROTECTED_AREAS,
   symlinkPaths:changeSet.symlinkPaths,
   stagedPaths:changeSet.stagedPaths,
   secretPaths:changeSet.secretFiles,
   totalBytes:changeSet.totalBytes,
   branchChanged:changeSet.branchChanged,
   headChanged:changeSet.headChanged,
   gitMetadataChanged:changeSet.gitMetadataChanged,
   lockChanged:changeSet.lockChanged,
   patch:changeSet.patch
  });

  let rolledBack=false;
  let quarantine=null;
  const identityDrift=result.violations.some(code=>
   ['BRANCH_DRIFT','HEAD_DRIFT','GIT_METADATA_DRIFT','REPO_LOCK_DRIFT'].includes(code)
  );
  if(!result.allowed&&rollbackOnViolation&&!identityDrift){
   quarantine=await quarantineAndRollback(this,changeSet);
   rolledBack=true;
  }

  return Object.freeze({
   ...result,
   transactionId:this.id,
   rolledBack,
   quarantineCreated:Boolean(quarantine),
   manualRecoveryRequired:!result.allowed&&identityDrift
  });
 }

 async rollback(reason='PIPELINE_FAILED'){
  if(this.released)throw new Error('Maintenance transaction sudah dilepas.');
  const changeSet=await collectChangeSet(this);
  const identity={
   branchChanged:changeSet.branchChanged,
   headChanged:changeSet.headChanged,
   gitMetadataChanged:changeSet.gitMetadataChanged,
   lockChanged:changeSet.lockChanged
  };
  if(Object.values(identity).some(Boolean)){
   const error=new Error('Rollback otomatis diblokir karena identitas repository berubah; recovery manual diperlukan.');
   error.code='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED';
   error.reason=reason;
   error.identity=identity;
   throw error;
  }
  if(!changeSet.paths.length&&!changeSet.secretFiles.length){
   return Object.freeze({rolledBack:false,reason,transactionId:this.id});
  }
  await quarantineAndRollback(this,changeSet);
  return Object.freeze({rolledBack:true,reason,transactionId:this.id,quarantineCreated:true});
 }

 async release(){
  if(this.released)return;
  await releaseLock(this);
  if(this.isolatedHome)await rm(this.isolatedHome,{recursive:true,force:true});
  this.released=true;
 }
}

export async function beginMaintenanceTransaction(cwd){
 return MaintenanceTransaction.begin(cwd);
}
