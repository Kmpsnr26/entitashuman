import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  mkdtemp,realpath,rm
} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {sanitizeMaintenanceEnvironment} from './agent-maintenance-guard.mjs';

export const MAINTENANCE_WORKSPACE_VERSION='1.0.0';
export const MAINTENANCE_BRANCH_PREFIX='automation/maintenance/';

const SAFE_ID=/^[a-z0-9][a-z0-9._:-]{0,119}$/i;

function sha256(value){
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeSegment(value,max=48){
  const normalized=String(value??'')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,max);
  if(!normalized)throw new TypeError('Workspace branch segment tidak valid.');
  return normalized;
}

function maintenanceBranchName(finding){
  if(!finding||!SAFE_ID.test(String(finding.id||''))){
    throw new TypeError('Workspace membutuhkan finding id valid.');
  }
  if(!/^[a-f0-9]{64}$/i.test(String(finding.fingerprint||''))){
    throw new TypeError('Workspace membutuhkan finding fingerprint valid.');
  }
  return (
    MAINTENANCE_BRANCH_PREFIX+
    safeSegment(finding.id,48)+'-'+
    String(finding.fingerprint).slice(0,12).toLowerCase()
  );
}

async function runGit(cwd,args,{allowFailure=false,timeout=30000}={}){
  const env=sanitizeMaintenanceEnvironment(process.env).env;
  return await new Promise((resolvePromise,reject)=>{
    const child=spawn('git',args,{
      cwd,
      windowsHide:true,
      shell:false,
      stdio:['ignore','pipe','pipe'],
      env
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
      finish(new Error('Git workspace command timeout: '+args.join(' ')));
    },timeout);
    child.stdout.on('data',data=>{stdout=(stdout+String(data)).slice(-2*1024*1024);});
    child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-64000);});
    child.on('error',error=>finish(error));
    child.on('close',code=>{
      const result={code,stdout,stderr};
      if(code===0||allowFailure)return finish(null,result);
      finish(new Error(
        'Git workspace command gagal: git '+args.join(' ')+'\n'+stderr.trim()
      ));
    });
  });
}

async function gitText(cwd,args,options){
  return (await runGit(cwd,args,options)).stdout.trim();
}

async function assertSourceRepository(root){
  const requested=await realpath(resolve(root));
  const gitRoot=await realpath(await gitText(requested,['rev-parse','--show-toplevel']));
  if(requested!==gitRoot){
    const error=new Error('Workspace broker harus menerima root repository Git.');
    error.code='MAINTENANCE_WORKSPACE_ROOT_MISMATCH';
    throw error;
  }
  const status=await gitText(gitRoot,[
    'status','--porcelain=v1','--untracked-files=all'
  ]);
  if(status){
    const error=new Error(
      'Workspace broker memerlukan source checkout bersih sebelum membuat worktree.'
    );
    error.code='MAINTENANCE_WORKSPACE_SOURCE_DIRTY';
    throw error;
  }
  return gitRoot;
}

async function branchExists(root,branchName){
  const result=await runGit(root,[
    'show-ref','--verify','--quiet','refs/heads/'+branchName
  ],{allowFailure:true});
  return result.code===0;
}

async function removeBranch(root,branchName){
  const exists=await branchExists(root,branchName);
  if(!exists)return;
  await runGit(root,['branch','-D',branchName]);
}

export class TrustedMaintenanceWorkspaceBroker{
  constructor({temporaryRoot=tmpdir(),now=()=>Date.now()}={}){
    this.temporaryRoot=temporaryRoot;
    this.now=now;
    this.active=new Map();
  }

  async prepare({repoRoot,finding,baseRef='HEAD'}={}){
    const root=await assertSourceRepository(repoRoot);
    const branchName=maintenanceBranchName(finding);
    if(await branchExists(root,branchName)){
      const error=new Error(
        'Branch maintenance sudah ada; broker tidak akan menimpa branch lama.'
      );
      error.code='MAINTENANCE_WORKSPACE_BRANCH_EXISTS';
      throw error;
    }

    const baseHead=await gitText(root,['rev-parse','--verify',baseRef]);
    const baseBranch=await gitText(root,['branch','--show-current']);
    if(!baseBranch){
      const error=new Error('Workspace broker tidak menerima source checkout detached HEAD.');
      error.code='MAINTENANCE_WORKSPACE_DETACHED_HEAD';
      throw error;
    }
    if(!baseHead){
      const error=new Error('Base ref maintenance tidak dapat di-resolve.');
      error.code='MAINTENANCE_WORKSPACE_BASE_INVALID';
      throw error;
    }

    const container=await mkdtemp(join(this.temporaryRoot,'humanale-maintenance-'));
    const workspacePath=join(container,'repo');
    let prepared=false;
    try{
      await runGit(root,[
        'worktree','add','-b',branchName,workspacePath,baseHead
      ]);
      prepared=true;
      const realWorkspace=await realpath(workspacePath);
      const workspaceHead=await gitText(realWorkspace,['rev-parse','HEAD']);
      const workspaceBranch=await gitText(realWorkspace,['branch','--show-current']);
      if(workspaceHead!==baseHead||workspaceBranch!==branchName){
        const error=new Error('Workspace identity tidak sesuai dengan base/branch broker.');
        error.code='MAINTENANCE_WORKSPACE_IDENTITY_MISMATCH';
        throw error;
      }

      const state=Object.freeze({
        id:'workspace-'+sha256(
          finding.fingerprint+'\0'+baseHead+'\0'+this.now()
        ).slice(0,24),
        version:MAINTENANCE_WORKSPACE_VERSION,
        repoRoot:root,
        path:realWorkspace,
        container,
        baseRef:String(baseRef),
        baseHead,
        baseBranch,
        branchName,
        findingId:finding.id,
        findingFingerprint:finding.fingerprint,
        createdAt:this.now(),
        checkpointed:false
      });
      this.active.set(state.id,state);
      return state;
    }catch(error){
      if(prepared){
        try{await runGit(root,['worktree','remove','--force',workspacePath]);}catch{}
        try{await removeBranch(root,branchName);}catch{}
      }
      await rm(container,{recursive:true,force:true});
      throw error;
    }
  }

  get(id){
    return this.active.get(String(id))||null;
  }

  async checkpoint(workspace,{
    verification,
    title='Verified AI maintenance patch'
  }={}){
    const state=this.get(workspace?.id);
    if(!state||state.path!==workspace.path){
      throw new Error('Workspace checkpoint tidak dikenal broker.');
    }
    if(state.checkpointed){
      throw new Error('Workspace sudah memiliki checkpoint.');
    }
    if(!verification||verification.ok!==true){
      const error=new Error('Checkpoint membutuhkan trusted verification PASS.');
      error.code='MAINTENANCE_CHECKPOINT_VERIFY_REQUIRED';
      throw error;
    }

    const branch=await gitText(state.path,['branch','--show-current']);
    const headBefore=await gitText(state.path,['rev-parse','HEAD']);
    if(branch!==state.branchName||headBefore!==state.baseHead){
      const error=new Error('Workspace HEAD/branch berubah sebelum trusted checkpoint.');
      error.code='MAINTENANCE_CHECKPOINT_IDENTITY_DRIFT';
      throw error;
    }

    const status=await gitText(state.path,[
      'status','--porcelain=v1','--untracked-files=all'
    ]);
    if(!status){
      const error=new Error('Tidak ada verified patch untuk di-checkpoint.');
      error.code='MAINTENANCE_CHECKPOINT_EMPTY';
      throw error;
    }

    await runGit(state.path,['add','--all']);
    await runGit(state.path,[
      '-c','user.name=HumanALE Maintenance Broker',
      '-c','user.email=humanale-maintenance@invalid.local',
      'commit',
      '-m',String(title).slice(0,120)
    ]);

    const commitSha=await gitText(state.path,['rev-parse','HEAD']);
    const parentSha=await gitText(state.path,['rev-parse','HEAD^']);
    if(parentSha!==state.baseHead){
      const error=new Error('Checkpoint bukan single commit tepat di atas base HEAD.');
      error.code='MAINTENANCE_CHECKPOINT_PARENT_MISMATCH';
      throw error;
    }

    const updated=Object.freeze({
      ...state,
      checkpointed:true,
      commitSha,
      checkpointedAt:this.now()
    });
    this.active.set(state.id,updated);
    return Object.freeze({
      workspaceId:state.id,
      branchName:state.branchName,
      baseBranch:state.baseBranch,
      baseHead:state.baseHead,
      commitSha,
      verified:true,
      findingId:state.findingId,
      findingFingerprint:state.findingFingerprint
    });
  }

  async finalizePublished(workspace,draft){
    const state=this.get(workspace?.id);
    if(!state||state.checkpointed!==true){
      throw new Error('Finalize membutuhkan checkpointed workspace yang dikenal broker.');
    }
    if(!draft||draft.draft!==true||!draft.url){
      throw new Error('Finalize membutuhkan verified Draft PR result.');
    }
    try{
      await runGit(state.repoRoot,['worktree','remove','--force',state.path]);
    }finally{
      try{await removeBranch(state.repoRoot,state.branchName);}catch{}
      this.active.delete(state.id);
      await rm(state.container,{recursive:true,force:true});
    }
    return true;
  }

  async discard(workspace,{deleteBranch=true}={}){
    const state=this.get(workspace?.id)||workspace;
    if(!state?.repoRoot||!state?.path)return false;

    try{
      await runGit(state.repoRoot,['worktree','remove','--force',state.path]);
    }finally{
      if(deleteBranch&&!state.checkpointed){
        try{await removeBranch(state.repoRoot,state.branchName);}catch{}
      }
      this.active.delete(state.id);
      await rm(state.container,{recursive:true,force:true});
    }
    return true;
  }
}

export function createMaintenanceWorkspaceBroker(options){
  return new TrustedMaintenanceWorkspaceBroker(options);
}
