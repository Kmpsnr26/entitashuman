import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  MAINTENANCE_BRANCH_PREFIX,
  TrustedMaintenanceWorkspaceBroker
} from '../desktop/maintenance-workspace.mjs';

function git(cwd,...args){
  return execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
}

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'humanale-workspace-source-'));
  git(root,'init');
  git(root,'config','user.name','HumanALE Test');
  git(root,'config','user.email','humanale-test@example.invalid');
  await writeFile(join(root,'app.js'),'export const value=1;\n','utf8');
  git(root,'add','.');
  git(root,'commit','-m','baseline');
  return root;
}

const finding=Object.freeze({
  id:'render-failure-1',
  fingerprint:'a'.repeat(64)
});

test('workspace broker creates an isolated deterministic maintenance branch',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp,now:()=>100});
    const workspace=await broker.prepare({repoRoot:root,finding});
    assert.match(workspace.branchName,new RegExp('^'+MAINTENANCE_BRANCH_PREFIX.replaceAll('/','\\/')));
    assert.notEqual(workspace.path,root);
    assert.equal(git(workspace.path,'rev-parse','HEAD'),workspace.baseHead);
    assert.equal(git(workspace.path,'branch','--show-current'),workspace.branchName);
    assert.equal(
      (await readFile(join(workspace.path,'app.js'),'utf8')).replace(/\r\n/g,'\n'),
      'export const value=1;\n'
    );
    await broker.discard(workspace);
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});

test('dirty source checkout is rejected before a worktree is created',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    await writeFile(join(root,'app.js'),'human edit\n','utf8');
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp});
    await assert.rejects(
      ()=>broker.prepare({repoRoot:root,finding}),
      error=>error?.code==='MAINTENANCE_WORKSPACE_SOURCE_DIRTY'
    );
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});

test('existing deterministic maintenance branch is never overwritten',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp});
    const first=await broker.prepare({repoRoot:root,finding});
    await broker.discard(first,{deleteBranch:false});
    await assert.rejects(
      ()=>broker.prepare({repoRoot:root,finding}),
      error=>error?.code==='MAINTENANCE_WORKSPACE_BRANCH_EXISTS'
    );
    git(root,'branch','-D',first.branchName);
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});

test('checkpoint requires trusted verification PASS and creates one commit over base',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp,now:(()=>{let n=100;return()=>++n;})()});
    const workspace=await broker.prepare({repoRoot:root,finding});
    await writeFile(join(workspace.path,'app.js'),'export const value=2;\n','utf8');

    await assert.rejects(
      ()=>broker.checkpoint(workspace,{verification:{ok:false}}),
      error=>error?.code==='MAINTENANCE_CHECKPOINT_VERIFY_REQUIRED'
    );

    const receipt=await broker.checkpoint(workspace,{
      verification:{ok:true},
      title:'Repair renderer regression'
    });
    assert.equal(receipt.verified,true);
    assert.equal(receipt.baseHead,workspace.baseHead);
    assert.equal(git(workspace.path,'rev-parse','HEAD^'),workspace.baseHead);
    assert.equal(git(workspace.path,'rev-parse','HEAD'),receipt.commitSha);
    assert.equal(git(workspace.path,'status','--porcelain'),'');
    await broker.discard(broker.get(workspace.id),{deleteBranch:false});
    git(root,'branch','-D',workspace.branchName);
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});

test('empty workspace cannot be checkpointed',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp});
    const workspace=await broker.prepare({repoRoot:root,finding});
    await assert.rejects(
      ()=>broker.checkpoint(workspace,{verification:{ok:true}}),
      error=>error?.code==='MAINTENANCE_CHECKPOINT_EMPTY'
    );
    await broker.discard(workspace);
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});

test('failed/uncheckpointed workspace discard removes its local maintenance branch',async()=>{
  const root=await fixture();
  const temp=await mkdtemp(join(tmpdir(),'humanale-workspace-root-'));
  try{
    const broker=new TrustedMaintenanceWorkspaceBroker({temporaryRoot:temp});
    const workspace=await broker.prepare({repoRoot:root,finding});
    await broker.discard(workspace);
    const result=execFileSync(
      'git',
      ['show-ref','--verify','--quiet','refs/heads/'+workspace.branchName],
      {cwd:root,encoding:'utf8',stdio:'pipe'}
    );
    assert.equal(result,'');
  }catch(error){
    if(error?.status===1){
      assert.equal(error.status,1);
    }else throw error;
  }finally{
    await rm(root,{recursive:true,force:true});
    await rm(temp,{recursive:true,force:true});
  }
});
