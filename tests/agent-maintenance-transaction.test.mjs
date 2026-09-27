import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
 beginMaintenanceTransaction,
 parseMaintenancePorcelainZ
} from '../desktop/agent-maintenance-transaction.mjs';

function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
}

async function repoFixture(){
 const root=await mkdtemp(join(tmpdir(),'humanale-maintenance-'));
 git(root,'init');
 git(root,'config','user.name','HumanALE Test');
 git(root,'config','user.email','humanale-test@example.invalid');
 await writeFile(join(root,'.gitignore'),'.env\n*.pfx\n','utf8');
 await writeFile(join(root,'app.js'),'export const value=1;\n','utf8');
 await mkdir(join(root,'desktop'),{recursive:true});
 await writeFile(join(root,'desktop','agent-maintenance-policy.mjs'),'export const boundary="baseline";\n','utf8');
 await writeFile(join(root,'policy.txt'),'owner boundary\n','utf8');
 git(root,'add','.');
 git(root,'commit','-m','baseline');
 const initialBranch=git(root,'branch','--show-current');
 git(root,'switch','-c','maintenance/test');
 return {root,initialBranch};
}

test('porcelain parser handles normal and rename records',()=>{
 const parsed=parseMaintenancePorcelainZ(' M app.js\0R  new.js\0old.js\0?? extra.js\0');
 assert.deepEqual(parsed.map(item=>({status:item.status,paths:[...item.paths],untracked:item.untracked})),[
  {status:' M',paths:['app.js'],untracked:false},
  {status:'R ',paths:['new.js','old.js'],untracked:false},
  {status:'??',paths:['extra.js'],untracked:true}
 ]);
});

test('transaction accepts a small unprotected working-tree edit',async()=>{
 const {root}=await repoFixture();
 try{
  const tx=await beginMaintenanceTransaction(root);
  await writeFile(join(root,'app.js'),'export const value=2;\n','utf8');
  const result=await tx.inspect();
  assert.equal(result.allowed,true);
  assert.equal(result.rolledBack,false);
  await tx.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('transaction repository lock blocks concurrent maintenance sessions',async()=>{
 const {root}=await repoFixture();
 try{
  const first=await beginMaintenanceTransaction(root);
  await assert.rejects(
   ()=>beginMaintenanceTransaction(root),
   error=>error?.code==='AI_MAINTENANCE_REPO_LOCKED'
  );
  await first.release();
  const second=await beginMaintenanceTransaction(root);
  await second.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('ignored secret file blocks transaction before any agent can run',async()=>{
 const {root}=await repoFixture();
 try{
  await writeFile(join(root,'.env'),'OPENAI_API_KEY=secret\n','utf8');
  await assert.rejects(
   ()=>beginMaintenanceTransaction(root),
   error=>error?.code==='AI_MAINTENANCE_SECRET_FILE_PRESENT'
  );
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('tracked protected policy edit is quarantined and restored exactly to baseline',async()=>{
 const {root}=await repoFixture();
 try{
  const tx=await beginMaintenanceTransaction(root);
  const protectedFile=join(root,'desktop','agent-maintenance-policy.mjs');
  await writeFile(protectedFile,'export const boundary="weakened";\n','utf8');

  const result=await tx.inspect();
  assert.equal(result.allowed,false);
  assert.ok(result.violations.includes('PROTECTED_PATH_CHANGE'));
  assert.equal(result.rolledBack,true);
  assert.equal(
   (await readFile(protectedFile,'utf8')).replace(/\r\n/g,'\n'),
   'export const boundary="baseline";\n'
  );
  assert.equal(git(root,'status','--porcelain'),'');
  await tx.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('staged changes fail closed and are rolled back',async()=>{
 const {root}=await repoFixture();
 try{
  const tx=await beginMaintenanceTransaction(root);
  await writeFile(join(root,'app.js'),'export const value=3;\n','utf8');
  git(root,'add','app.js');
  const result=await tx.inspect();
  assert.equal(result.allowed,false);
  assert.ok(result.violations.includes('STAGED_CHANGE'));
  assert.equal(result.rolledBack,true);
  assert.equal((await readFile(join(root,'app.js'),'utf8')).replace(/\r\n/g,'\n'),'export const value=1;\n');
  assert.equal(git(root,'status','--porcelain'),'');
  await tx.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('HEAD or branch drift requires manual recovery and is never auto-reset',async()=>{
 const {root}=await repoFixture();
 try{
  const tx=await beginMaintenanceTransaction(root);
  git(root,'switch','-c','maintenance/drift');
  const result=await tx.inspect();
  assert.equal(result.allowed,false);
  assert.ok(result.violations.includes('BRANCH_DRIFT'));
  assert.equal(result.rolledBack,false);
  assert.equal(result.manualRecoveryRequired,true);
  git(root,'switch','maintenance/test');
  await tx.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test('main/master and release candidate branches are write-protected',async()=>{
 const {root,initialBranch}=await repoFixture();
 try{
  git(root,'switch',initialBranch);
  await assert.rejects(
   ()=>beginMaintenanceTransaction(root),
   error=>error?.code==='AI_MAINTENANCE_PROTECTED_BRANCH'
  );
  git(root,'switch','maintenance/test');
  git(root,'branch','codex/release-2.5.0-final-candidate');
  git(root,'switch','codex/release-2.5.0-final-candidate');
  await assert.rejects(
   ()=>beginMaintenanceTransaction(root),
   error=>error?.code==='AI_MAINTENANCE_PROTECTED_BRANCH'
  );
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});


test('explicit rollback quarantines and removes otherwise safe partial worker changes',async()=>{
 const {root}=await repoFixture();
 try{
  const tx=await beginMaintenanceTransaction(root);
  await writeFile(join(root,'app.js'),'export const partial=true;\n','utf8');
  const rollback=await tx.rollback('WORKER_FAILED');
  assert.equal(rollback.rolledBack,true);
  assert.equal(rollback.quarantineCreated,true);
  assert.equal(await readFile(join(root,'app.js'),'utf8'),'export const value=1;\n');
  assert.equal(git(root,'status','--porcelain'),'');
  await tx.release();
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});
