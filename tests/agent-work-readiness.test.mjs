import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectMaintenanceReadiness,beginMaintenanceTransaction,AI_MAINTENANCE_LOCK_FILE} from '../desktop/agent-maintenance-transaction.mjs';
import {codexLoginProbe,DeveloperAgentHub} from '../desktop/agent-hub.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'humanale-work-readiness-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 git(root,'init');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.invalid');
 await writeFile(join(root,'.gitignore'),'.env\nlinked\n','utf8');await writeFile(join(root,'app.js'),'export const ok=true;\n','utf8');
 git(root,'add','.');git(root,'commit','-m','fixture');git(root,'switch','-c','maintenance/ready');
 return root;
}

test('readiness is advisory without lock, index refresh, credential read or source mutation',async t=>{
 const root=await fixture(t),index=join(root,'.git','index');
 await mkdir(join(root,'nested'));await writeFile(join(root,'nested','note.txt'),'untracked');
 const statusBefore=git(root,'--no-optional-locks','status','--porcelain');
 const before=await readFile(index),metadata=await stat(index);
 const result=await inspectMaintenanceReadiness(root);
 assert.equal(result.ready,false);assert.equal(result.code,'AI_MAINTENANCE_DIRTY_WORKTREE');
 assert.equal(git(root,'--no-optional-locks','status','--porcelain'),statusBefore);
 assert.deepEqual(await readFile(index),before);assert.equal((await stat(index)).mtimeMs,metadata.mtimeMs);
 await assert.rejects(stat(join(root,'.git',AI_MAINTENANCE_LOCK_FILE)),{code:'ENOENT'});
});

test('protected selected release branch refuses readiness and actual transaction before locking',async t=>{
 const root=await fixture(t);
 git(root,'switch','-c','codex/release-2.5.0-final-candidate');
 const result=await inspectMaintenanceReadiness(root);
 assert.equal(result.ready,false);assert.equal(result.code,'AI_MAINTENANCE_PROTECTED_BRANCH');
 assert.match(result.error,/codex\/release-2\.5\.0-final-candidate/);
 await assert.rejects(beginMaintenanceTransaction(root),{code:result.code});
 await assert.rejects(stat(join(root,'.git',AI_MAINTENANCE_LOCK_FILE)),{code:'ENOENT'});
});

test('readiness preserves secret, symlink and lock refusal plus work recheck',async t=>{
 const root=await fixture(t);
 assert.equal((await inspectMaintenanceReadiness(root)).ready,true);
 await writeFile(join(root,'.env'),'fixture secret never read');
 assert.equal((await inspectMaintenanceReadiness(root)).code,'AI_MAINTENANCE_SECRET_FILE_PRESENT');
 await assert.rejects(beginMaintenanceTransaction(root),{code:'AI_MAINTENANCE_SECRET_FILE_PRESENT'});
 assert.equal(await readFile(join(root,'.env'),'utf8'),'fixture secret never read');
 await rm(join(root,'.env'));
 const target=await mkdtemp(join(tmpdir(),'humanale-readiness-link-target-'));t.after(()=>rm(target,{recursive:true,force:true}));
 await symlink(target,join(root,'linked'),process.platform==='win32'?'junction':'dir');
 assert.equal((await inspectMaintenanceReadiness(root)).code,'AI_MAINTENANCE_BASELINE_SYMLINK_PRESENT');
 await rm(join(root,'linked'));
 const tx=await beginMaintenanceTransaction(root);
 try{
  const lock=await readFile(tx.lockPath);
  assert.equal((await inspectMaintenanceReadiness(root)).code,'AI_MAINTENANCE_REPO_LOCKED');
  assert.deepEqual(await readFile(tx.lockPath),lock);
 }finally{await tx.release();}
 assert.equal((await inspectMaintenanceReadiness(root)).ready,true);
 await writeFile(join(root,'app.js'),'changed after successful advisory check');
 await assert.rejects(beginMaintenanceTransaction(root),{code:'AI_MAINTENANCE_DIRTY_WORKTREE'});
});

test('Codex probe distinguishes missing cwd, timeout, unknown output and genuine logged-out status',async t=>{
 const root=await fixture(t);
 const spawn=spawnSync(process.execPath,['--version'],{cwd:join(root,'missing'),encoding:'utf8',windowsHide:true});
 assert.equal(spawn.error.code,'ENOENT');
 assert.deepEqual(codexLoginProbe({code:spawn.status,error:spawn.error}),{ready:false,errorCode:'CODEX_PROBE_ENOENT'});
 assert.equal(codexLoginProbe({code:null,timedOut:true}).errorCode,'CODEX_PROBE_TIMEOUT');
 assert.equal(codexLoginProbe({code:1,stderr:'Not logged in'}).errorCode,'CODEX_NOT_LOGGED_IN');
 assert.equal(codexLoginProbe({code:0,stdout:'unknown response'}).errorCode,'CODEX_PROBE_UNRECOGNIZED');
 assert.deepEqual(codexLoginProbe({code:0,stderr:'Logged in using ChatGPT'}),{ready:true,errorCode:null});
 assert.equal(codexLoginProbe({code:1,stderr:'Logged in using ChatGPT'}).ready,false);
});

test('Hub distinguishes Git checkout presence from work readiness and reports missing cwd as probe error',async t=>{
 const root=await fixture(t),previous=process.env.CODEX_CLI_PATH;
 process.env.CODEX_CLI_PATH=process.execPath;
 t.after(()=>{if(previous===undefined)delete process.env.CODEX_CLI_PATH;else process.env.CODEX_CLI_PATH=previous;});
 git(root,'switch','-c','codex/release-blocked');
 const hub=new DeveloperAgentHub();hub.setProjectRoot(root);
 const blocked=await hub.status();
 assert.equal(blocked.projectRootReady,true);assert.equal(blocked.workReady,false);
 assert.equal(blocked.workReadiness.code,'AI_MAINTENANCE_PROTECTED_BRANCH');
 assert.equal(blocked.workBlockCode,blocked.workReadiness.code);
 assert.equal(blocked.workBlockReason,blocked.workReadiness.error);
 hub.setProjectRoot(join(root,'missing'));
 const missing=await hub.status(),codex=missing.agents.find(agent=>agent.id==='codex');
 assert.equal(missing.projectRootReady,false);assert.equal(missing.workReady,false);
 assert.equal(codex.canRun,false);assert.equal(codex.errorCode,'CODEX_PROBE_ENOENT');
 assert.match(codex.detail,/folder proyek atau executable tidak tersedia/);
 assert.doesNotMatch(codex.detail,/belum login/);
});
