import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {
 AI_MAINTENANCE_MAX_CHANGED_BYTES,
 AI_MAINTENANCE_MAX_CHANGED_FILES,
 sanitizeMaintenanceEnvironment
} from './agent-maintenance-guard.mjs';

export const TRUSTED_CHECKPOINT_BROKER_VERSION='1.0.0';
export const TRUSTED_CHECKPOINT_BRANCH_PREFIX='automation/maintenance/';

const SHA=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const MAX_GIT_OUTPUT=4*1024*1024;

function failure(message,code){
 const error=new Error(message);
 error.code=code;
 return error;
}

function sha256(value){
 return createHash('sha256').update(value).digest('hex');
}

function safeSegment(value,max=48){
 const result=String(value??'').trim().toLowerCase()
  .replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,max);
 if(!result)throw new TypeError('Checkpoint branch segment tidak valid.');
 return result;
}

function branchNameFor(finding){
 if(!finding||!SAFE_ID.test(String(finding.id||''))){
  throw new TypeError('Trusted checkpoint membutuhkan finding id valid.');
 }
 if(!SHA256.test(String(finding.fingerprint||''))){
  throw new TypeError('Trusted checkpoint membutuhkan finding fingerprint SHA-256.');
 }
 return TRUSTED_CHECKPOINT_BRANCH_PREFIX+
  safeSegment(finding.id)+'-'+String(finding.fingerprint).slice(0,12).toLowerCase();
}

async function runGit(cwd,args,{allowFailure=false,timeout=30000}={}){
 const env=sanitizeMaintenanceEnvironment(process.env).env;
 return await new Promise((resolvePromise,reject)=>{
  const child=spawn('git',args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env});
  let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   error?reject(error):resolvePromise(value);
  };
  const append=(current,data)=>{
   const next=current+String(data);
   if(Buffer.byteLength(next,'utf8')>MAX_GIT_OUTPUT){
    child.kill();
    finish(failure('Output Git checkpoint melewati batas aman.','TRUSTED_CHECKPOINT_GIT_OUTPUT_TOO_LARGE'));
    return current;
   }
   return next;
  };
  const timer=setTimeout(()=>{
   child.kill();
   finish(failure('Git checkpoint command timeout.','TRUSTED_CHECKPOINT_GIT_TIMEOUT'));
  },timeout);
  child.stdout.on('data',data=>{stdout=append(stdout,data);});
  child.stderr.on('data',data=>{stderr=append(stderr,data);});
  child.on('error',error=>finish(error));
  child.on('close',code=>{
   if(settled)return;
   const result={code,stdout,stderr};
   if(code===0||allowFailure)return finish(null,result);
   finish(failure('Git checkpoint command gagal: git '+args.join(' '),'TRUSTED_CHECKPOINT_GIT_FAILED'));
  });
 });
}

async function gitText(cwd,args,options){
 return (await runGit(cwd,args,options)).stdout.trim();
}

async function branchExists(root,branchName){
 return (await runGit(root,['show-ref','--verify','--quiet','refs/heads/'+branchName],{allowFailure:true})).code===0;
}

async function removeBranch(root,branchName){
 if(await branchExists(root,branchName))await runGit(root,['branch','-D',branchName]);
}

async function assertCleanSource(repoRoot){
 const requested=await realpath(resolve(repoRoot));
 const gitRoot=await realpath(await gitText(requested,['rev-parse','--show-toplevel']));
 if(requested!==gitRoot)throw failure('Checkpoint broker harus menerima root repository Git.','TRUSTED_CHECKPOINT_ROOT_MISMATCH');
 const status=await gitText(gitRoot,['status','--porcelain=v1','-z','--untracked-files=all']);
 if(status)throw failure('Source checkout harus bersih sebelum worktree checkpoint dibuat.','TRUSTED_CHECKPOINT_SOURCE_DIRTY');
 const branch=await gitText(gitRoot,['branch','--show-current']);
 if(!branch)throw failure('Source checkout detached HEAD tidak diterima.','TRUSTED_CHECKPOINT_SOURCE_DETACHED');
 return {gitRoot,branch};
}

export async function computeMaintenanceCheckpointState(cwd,baseHead){
 const root=await realpath(resolve(cwd));
 const base=String(baseHead||'').trim();
 if(!SHA.test(base))throw failure('Base HEAD checkpoint tidak valid.','TRUSTED_CHECKPOINT_BASE_INVALID');
 const resolvedBase=await gitText(root,['rev-parse','--verify',base+'^{commit}']);
 if(resolvedBase.toLowerCase()!==base.toLowerCase()){
  throw failure('Base HEAD checkpoint tidak resolve ke commit yang sama.','TRUSTED_CHECKPOINT_BASE_MISMATCH');
 }

 const [head,branch,trackedPatch,trackedNamesRaw,untrackedRaw]=await Promise.all([
  gitText(root,['rev-parse','HEAD']),
  gitText(root,['branch','--show-current']),
  runGit(root,['diff','--binary',base,'--']).then(result=>result.stdout),
  runGit(root,['diff','--name-only','-z',base,'--']).then(result=>result.stdout),
  runGit(root,['ls-files','--others','--exclude-standard','-z']).then(result=>result.stdout)
 ]);
 const tracked=trackedNamesRaw.split('\0').filter(Boolean);
 const untracked=untrackedRaw.split('\0').filter(Boolean);
 const paths=[...new Set([...tracked,...untracked])].sort();
 if(paths.length>AI_MAINTENANCE_MAX_CHANGED_FILES){
  throw failure('Checkpoint changeset memiliki terlalu banyak file.','TRUSTED_CHECKPOINT_TOO_MANY_FILES');
 }

 let totalBytes=0;
 const untrackedEvidence=[];
 for(const path of paths){
  try{
   const info=await lstat(join(root,path));
   if(info.isSymbolicLink())throw failure('Checkpoint menolak symbolic link.','TRUSTED_CHECKPOINT_SYMLINK');
   if(info.isFile())totalBytes+=info.size;
  }catch(error){
   if(error?.code!=='ENOENT')throw error;
  }
 }
 if(totalBytes>AI_MAINTENANCE_MAX_CHANGED_BYTES){
  throw failure('Checkpoint changeset melewati batas ukuran.','TRUSTED_CHECKPOINT_TOO_LARGE');
 }
 for(const path of untracked.sort()){
  const data=await readFile(join(root,path));
  untrackedEvidence.push([path,data.length,sha256(data)]);
 }

 const fingerprint=sha256(JSON.stringify({
  baseHead:base.toLowerCase(),
  trackedPatch,
  untracked:untrackedEvidence
 }));
 return Object.freeze({
  root,
  baseHead:base,
  head,
  branch,
  changeFingerprint:fingerprint,
  changedFiles:paths.length,
  totalBytes,
  paths:Object.freeze(paths),
  empty:paths.length===0
 });
}

export class TrustedCheckpointBroker{
 constructor({temporaryRoot=tmpdir(),now=()=>Date.now()}={}){
  this.temporaryRoot=temporaryRoot;
  this.now=now;
  this.active=new Map();
 }

 async prepare({repoRoot,finding,baseRef='HEAD'}={}){
  const {gitRoot,branch:baseBranch}=await assertCleanSource(repoRoot);
  const branchName=branchNameFor(finding);
  if(await branchExists(gitRoot,branchName)){
   throw failure('Branch checkpoint maintenance sudah ada dan tidak akan ditimpa.','TRUSTED_CHECKPOINT_BRANCH_EXISTS');
  }
  const baseHead=await gitText(gitRoot,['rev-parse','--verify',String(baseRef||'HEAD')+'^{commit}']);
  if(!SHA.test(baseHead))throw failure('Base ref checkpoint tidak valid.','TRUSTED_CHECKPOINT_BASE_INVALID');

  const container=await mkdtemp(join(this.temporaryRoot,'humanale-checkpoint-'));
  const workspacePath=join(container,'repo');
  let added=false;
  try{
   await runGit(gitRoot,['worktree','add','-b',branchName,workspacePath,baseHead]);
   added=true;
   const path=await realpath(workspacePath);
   const [head,activeBranch]=await Promise.all([
    gitText(path,['rev-parse','HEAD']),
    gitText(path,['branch','--show-current'])
   ]);
   if(head!==baseHead||activeBranch!==branchName){
    throw failure('Identitas worktree checkpoint tidak cocok.','TRUSTED_CHECKPOINT_WORKTREE_IDENTITY_MISMATCH');
   }
   const state=Object.freeze({
    id:'checkpoint-'+sha256(String(finding.fingerprint)+'\0'+baseHead+'\0'+String(this.now())).slice(0,24),
    version:TRUSTED_CHECKPOINT_BROKER_VERSION,
    repoRoot:gitRoot,
    path,
    container,
    baseRef:String(baseRef||'HEAD'),
    baseHead,
    baseBranch,
    branchName,
    findingId:String(finding.id),
    findingFingerprint:String(finding.fingerprint).toLowerCase(),
    createdAt:this.now(),
    checkpointed:false
   });
   this.active.set(state.id,state);
   return state;
  }catch(error){
   if(added){
    try{await runGit(gitRoot,['worktree','remove','--force',workspacePath]);}catch{}
    try{await removeBranch(gitRoot,branchName);}catch{}
   }
   await rm(container,{recursive:true,force:true});
   throw error;
  }
 }

 get(id){
  return this.active.get(String(id||''))||null;
 }

 async checkpoint(workspace,{verification}={}){
  const state=this.get(workspace?.id);
  if(!state||state.path!==workspace.path)throw failure('Worktree checkpoint tidak dikenal broker.','TRUSTED_CHECKPOINT_UNKNOWN_WORKSPACE');
  if(state.checkpointed)throw failure('Worktree sudah memiliki checkpoint.','TRUSTED_CHECKPOINT_ALREADY_COMMITTED');
  if(!verification||verification.ok!==true||verification.code!=='VERIFY_PASS'){
   throw failure('Checkpoint membutuhkan trusted verification PASS.','TRUSTED_CHECKPOINT_VERIFY_REQUIRED');
  }
  if(String(verification.baseHead||'').toLowerCase()!==state.baseHead.toLowerCase()||
     !SHA256.test(String(verification.changeFingerprint||''))){
   throw failure('Verification receipt tidak terikat ke base/diff checkpoint.','TRUSTED_CHECKPOINT_RECEIPT_INVALID');
  }

  const [branch,head]=await Promise.all([
   gitText(state.path,['branch','--show-current']),
   gitText(state.path,['rev-parse','HEAD'])
  ]);
  if(branch!==state.branchName||head!==state.baseHead){
   throw failure('Branch atau HEAD berubah sebelum checkpoint.','TRUSTED_CHECKPOINT_IDENTITY_DRIFT');
  }

  const current=await computeMaintenanceCheckpointState(state.path,state.baseHead);
  if(current.empty)throw failure('Tidak ada patch terverifikasi untuk di-checkpoint.','TRUSTED_CHECKPOINT_EMPTY');
  if(current.changeFingerprint!==verification.changeFingerprint){
   throw failure('Diff berubah setelah trusted verification.','TRUSTED_CHECKPOINT_FINGERPRINT_MISMATCH');
  }
  if(Number.isSafeInteger(verification.changedFiles)&&verification.changedFiles!==current.changedFiles){
   throw failure('Jumlah file berubah setelah trusted verification.','TRUSTED_CHECKPOINT_FILE_COUNT_MISMATCH');
  }

  await runGit(state.path,['add','--all']);
  const staged=(await runGit(state.path,['diff','--cached','--name-only','-z'])).stdout.split('\0').filter(Boolean).sort();
  if(JSON.stringify(staged)!==JSON.stringify([...current.paths].sort())){
   throw failure('Staged checkpoint tidak sama dengan diff terverifikasi.','TRUSTED_CHECKPOINT_STAGED_MISMATCH');
  }

  const message='HumanALE verified maintenance: '+safeSegment(state.findingId,64);
  await runGit(state.path,[
   '-c','user.name=HumanALE Trusted Checkpoint',
   '-c','user.email=humanale-checkpoint@invalid.local',
   'commit','-m',message
  ]);

  const [commitSha,parentSha,afterBranch,status]=await Promise.all([
   gitText(state.path,['rev-parse','HEAD']),
   gitText(state.path,['rev-parse','HEAD^']),
   gitText(state.path,['branch','--show-current']),
   gitText(state.path,['status','--porcelain=v1','-z','--untracked-files=all'])
  ]);
  if(parentSha!==state.baseHead||afterBranch!==state.branchName||status){
   throw failure('Checkpoint commit gagal mempertahankan identitas single-commit yang bersih.','TRUSTED_CHECKPOINT_COMMIT_INVALID');
  }

  const updated=Object.freeze({...state,checkpointed:true,commitSha,changeFingerprint:current.changeFingerprint,checkpointedAt:this.now()});
  this.active.set(state.id,updated);
  return Object.freeze({
   workspaceId:state.id,
   branchName:state.branchName,
   baseBranch:state.baseBranch,
   baseHead:state.baseHead,
   commitSha,
   verified:true,
   changeFingerprint:current.changeFingerprint,
   findingId:state.findingId,
   findingFingerprint:state.findingFingerprint
  });
 }

 async closeCheckpoint(workspace){
  const state=this.get(workspace?.id);
  if(!state||state.checkpointed!==true)throw failure('Close membutuhkan checkpoint yang valid.','TRUSTED_CHECKPOINT_CLOSE_DENIED');
  try{
   await runGit(state.repoRoot,['worktree','remove','--force',state.path]);
  }finally{
   this.active.delete(state.id);
   await rm(state.container,{recursive:true,force:true});
  }
  return Object.freeze({closed:true,branchName:state.branchName,commitSha:state.commitSha});
 }

 async discard(workspace){
  const state=this.get(workspace?.id)||workspace;
  if(!state?.repoRoot||!state?.path)return false;
  if(state.checkpointed)throw failure('Checkpoint terverifikasi tidak boleh dihapus melalui discard.','TRUSTED_CHECKPOINT_DISCARD_DENIED');
  try{
   await runGit(state.repoRoot,['worktree','remove','--force',state.path]);
  }finally{
   try{await removeBranch(state.repoRoot,state.branchName);}catch{}
   this.active.delete(state.id);
   await rm(state.container,{recursive:true,force:true});
  }
  return true;
 }

 snapshot(){
  return Object.freeze({
   version:TRUSTED_CHECKPOINT_BROKER_VERSION,
   activeWorkspaces:this.active.size,
   realtime:false,
   authority:Object.freeze({
    localCheckpoint:true,
    gitPush:false,
    gitMerge:false,
    draftPr:false,
    releasePublish:false,
    signing:false,
    owner:false,
    creatorApproval:false,
    credentialAccess:false
   })
  });
 }
}

export function createTrustedCheckpointBroker(options){
 return new TrustedCheckpointBroker(options);
}
