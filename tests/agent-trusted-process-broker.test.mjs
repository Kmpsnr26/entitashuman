import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmod,copyFile,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {DeveloperAgentHub} from '../desktop/agent-hub.mjs';
import {beginMaintenanceTransaction} from '../desktop/agent-maintenance-transaction.mjs';
import {createTrustedMaintenanceBroker} from '../desktop/agent-trusted-maintenance-broker.mjs';
import {createAIAutopilotTransaction} from '../desktop/agent-autopilot-transaction.mjs';
import {terminateMaintenanceProcessTree} from '../desktop/agent-trusted-process-broker.mjs';
import {isMaintenanceProtectedPath} from '../desktop/agent-maintenance-guard.mjs';
import {AI_MAINTENANCE_PROTECTED_AREAS} from '../desktop/agent-maintenance-policy.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let nativeContainer,nativeWorker,previousPath;
test.before(async()=>{
 nativeContainer=await mkdtemp(join(tmpdir(),'humanale-native-worker-'));
 previousPath=process.env.GITHUB_COPILOT_CLI_PATH;
 const descendant=join(nativeContainer,'descendant.mjs');
 await writeFile(descendant,"import {mkdirSync,writeFileSync} from 'node:fs'; writeFileSync('app.mjs','export const value=2;\\n'); mkdirSync('dist',{recursive:true});writeFileSync('dist/started.txt','started');setTimeout(()=>writeFileSync('app.mjs','export const value=99;\\n'),8000);\n");
 execFileSync(process.execPath,['--check',descendant],{encoding:'utf8'});
 if(process.platform==='win32'){
  // A native parent avoids Node/libuv's implicit Windows child-job cleanup.
  // The wrapper ignores CLI arguments, starts one bounded delayed writer and waits.
  const literal=value=>'@"'+value.replaceAll('"','""')+'"';
  nativeWorker=join(nativeContainer,'worker.exe');
  const source=join(nativeContainer,'worker.cs');
  const log=literal(join(nativeContainer,'launch.log'));
  await writeFile(source,'using System;using System.Diagnostics;using System.Threading;using System.IO;class Worker{static void Main(){var info=new ProcessStartInfo();info.FileName='+literal(process.execPath)+';info.Arguments='+literal('"'+descendant+'"')+';info.WorkingDirectory=Environment.CurrentDirectory;info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardError=true;File.WriteAllText('+log+',info.WorkingDirectory+" | "+info.FileName+" | "+info.Arguments);var child=Process.Start(info);new Thread(()=>File.AppendAllText('+log+',child.StandardError.ReadToEnd())).Start();Thread.Sleep(30000);}}');
  const compiler=['Framework64','Framework'].map(dir=>join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET',dir,'v4.0.30319','csc.exe')).find(existsSync);
  assert.ok(compiler,'Windows native fixture requires the installed .NET Framework C# compiler');
  execFileSync(compiler,['/nologo','/target:exe','/out:'+nativeWorker,source],{encoding:'utf8',windowsHide:true});
 }else{
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  nativeWorker=join(nativeContainer,'worker.sh');
  await writeFile(nativeWorker,'#!/bin/sh\n'+quote(process.execPath)+' '+quote(descendant)+' &\nwait\n');
  await chmod(nativeWorker,0o700);
 }
 process.env.GITHUB_COPILOT_CLI_PATH=nativeWorker;
});
test.after(async()=>{
 if(previousPath===undefined)delete process.env.GITHUB_COPILOT_CLI_PATH;else process.env.GITHUB_COPILOT_CLI_PATH=previousPath;
 if(nativeContainer)await rm(nativeContainer,{recursive:true,force:true});
});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'humanale-native-git-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'.gitignore'),'dist/\n');
 await writeFile(join(root,'app.mjs'),'export const value=1;\n');
 git(root,'init');git(root,'config','core.autocrlf','false');git(root,'config','user.name','HumanALE Test');git(root,'config','user.email','humanale-test@example.invalid');
 git(root,'add','.');git(root,'commit','-m','fixture');git(root,'switch','-c','maintenance/native-fixture');
 return root;
}
async function started(root){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  try{assert.equal(await readFile(join(root,'dist','started.txt'),'utf8'),'started');return;}catch{}
  await delay(30);
 }
 assert.fail('actual native worker descendant did not reach started marker');
}
function hub(root,{uncertain=false}={}){
 const h=new DeveloperAgentHub({timeoutForMode:()=>5000,
  beforeExecutorSpawn:({executable,id})=>{
   assert.equal(id,'github-copilot');
   assert.equal(realpathSync(executable),realpathSync(nativeWorker),'refuse any executor outside the controlled native fixture before spawn');
  },
  ...(uncertain?{processTerminator:async()=>({terminationConfirmed:false})}:{})
 });
 h.setProjectRoot(root);
 // Preserve actual runDirect arguments/spawn/timeout/termination and permission checks.
 // Only Planner/Reviewer selection and external account discovery are bypassed.
 h.runStructured=prompt=>h.runDirect('github-copilot',prompt,'work');
 return h;
}
function pipeline(root,h,signal){
 const transactions=[];
 const broker=createTrustedMaintenanceBroker({projectRoot:root,agentHub:h,
  detector:async()=>({ok:true,code:'BUG_FOUND'}),reproducer:async()=>({ok:true,code:'REPRODUCED'}),
  transactionFactory:async cwd=>{const tx=await beginMaintenanceTransaction(cwd);transactions.push(tx);return tx;},
  commandRunner:async()=>assert.fail('verifier must not run after interrupted worker')
 });
 const controller=createAIAutopilotTransaction({broker,limits:{maxAttempts:1}});
 return {broker,transactions,run:()=>controller.runOnce({signal})};
}
async function clean(root){
 assert.equal(await readFile(join(root,'app.mjs'),'utf8'),'export const value=1;\n');
 assert.equal(git(root,'status','--porcelain'),'');
 const tx=await beginMaintenanceTransaction(root);await tx.release();
}
async function operatorCleanup(h){
 // Test-only recovery occurs after independently confirming real tree stop.
 if(h.child)assert.equal((await terminateMaintenanceProcessTree(h.child)).terminationConfirmed,true);
 const tx=h.maintenanceTransaction;
 if(tx){tx.processTerminationUnconfirmed=false;await tx.rollback();await tx.release();}
 h.maintenanceTransaction=null;
}

test('process lifecycle helper remains inside protected maintenance source scope',()=>{
 assert.equal(isMaintenanceProtectedPath('desktop/agent-trusted-process-broker.mjs',AI_MAINTENANCE_PROTECTED_AREAS),true);
});

test('closed parent alone does not certify a Windows process tree as stopped',async()=>{
 const child=spawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true,detached:process.platform!=='win32',stdio:'ignore'});
 await once(child,'close');
 assert.equal((await terminateMaintenanceProcessTree(child)).terminationConfirmed,process.platform!=='win32');
});

test('native fixture guard rejects a different registered executable before executor spawn',async t=>{
 const root=await fixture(t);const h=hub(root);
 const other=join(nativeContainer,process.platform==='win32'?'different-worker.exe':'different-worker.sh');
 await copyFile(nativeWorker,other);if(process.platform!=='win32')await chmod(other,0o700);
 process.env.GITHUB_COPILOT_CLI_PATH=other;
 try{
  await assert.rejects(()=>h.run({id:'github-copilot',mode:'work',prompt:'Perbaiki bug source.'}),/refuse any executor outside/);
 }finally{process.env.GITHUB_COPILOT_CLI_PATH=nativeWorker;}
 assert.equal(h.child,null);assert.equal(h.maintenanceTransaction,null);
 assert.equal(existsSync(join(root,'dist','started.txt')),false);
 await clean(root);
});

test('actual runDirect native worker timeout stops descendant before broker rollback and no delayed write follows',async t=>{
 const root=await fixture(t);const h=hub(root);const p=pipeline(root,h);
 const result=await p.run();
 assert.equal(result.status,'ROLLED_BACK',JSON.stringify(result));
 assert.equal(result.steps.find(step=>step.name==='patch').code,'WORKER_TIMEOUT');
 assert.ok(existsSync(join(root,'dist','started.txt')),process.platform==='win32'?await readFile(join(nativeContainer,'launch.log'),'utf8'):'missing native descendant marker');
 assert.equal(await readFile(join(root,'dist','started.txt'),'utf8'),'started');
 assert.equal(p.transactions[0].released,true);assert.equal(p.broker.snapshot().activeSessions,0);
 await delay(8500);await clean(root);
});

test('actual runDirect native worker abort stops descendant before broker rollback',async t=>{
 const root=await fixture(t);const h=hub(root);const abort=new AbortController();const p=pipeline(root,h,abort.signal);
 const pending=p.run();await started(root);abort.abort();const result=await pending;
 assert.equal(result.status,'ROLLED_BACK');assert.equal(result.reason,'ABORTED');
 assert.equal(p.transactions[0].released,true);assert.equal(p.broker.snapshot().activeSessions,0);
 await delay(8500);await clean(root);
});

for(const action of ['timeout','abort']){
 test('unconfirmed actual worker '+action+' retains broker/controller transaction lock and forbids retry/rollback',async t=>{
  const root=await fixture(t);const h=hub(root,{uncertain:true});const abort=new AbortController();const p=pipeline(root,h,abort.signal);
  try{
   const pending=p.run();await started(root);if(action==='abort')abort.abort();const result=await pending;
   assert.equal(result.status,'FAILED');assert.equal(result.reason,'ROLLBACK_FAILED');assert.equal(result.attempts,1);
   assert.equal(p.transactions[0].released,false);assert.equal(p.broker.snapshot().activeSessions,1);
   assert.equal(h.maintenanceTransaction,p.transactions[0]);
   assert.equal((await p.broker.verify({transactionId:result.transactionId})).code,'MANUAL_RECOVERY_REQUIRED');
   assert.equal(await readFile(join(root,'app.mjs'),'utf8'),'export const value=2;\n');
   await assert.rejects(()=>beginMaintenanceTransaction(root),error=>error.code==='AI_MAINTENANCE_REPO_LOCKED');
   await assert.rejects(()=>h.run({id:'github-copilot',mode:'work',prompt:'Perbaiki bug source.'}),error=>error.code==='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED');
  }finally{await operatorCleanup(h);}
  await clean(root);
 });
 test('unconfirmed manual Hub.run '+action+' retains transaction lock instead of finally releasing',async t=>{
  const root=await fixture(t);const h=hub(root,{uncertain:true});
  try{
   const failure=assert.rejects(()=>h.run({id:'github-copilot',mode:'work',prompt:'Perbaiki bug source.'}),error=>error.code==='AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED');
   await started(root);if(action==='abort')await h.stop();await failure;
   assert.equal(h.maintenanceTransaction.released,false);
   assert.equal(h.maintenanceTransaction.processTerminationUnconfirmed,true);
   assert.equal(await readFile(join(root,'app.mjs'),'utf8'),'export const value=2;\n');
   await assert.rejects(()=>beginMaintenanceTransaction(root),error=>error.code==='AI_MAINTENANCE_REPO_LOCKED');
  }finally{await operatorCleanup(h);}
  await clean(root);
 });
}

test('manual Hub.run Stop waits for actual native tree termination before rollback/release',async t=>{
 const root=await fixture(t);const h=hub(root);
 const failure=assert.rejects(()=>h.run({id:'github-copilot',mode:'work',prompt:'Perbaiki bug source.'}),error=>error.code==='ABORTED');
 await started(root);await h.stop();await failure;
 assert.equal(h.maintenanceTransaction,null);await clean(root);
 await delay(8500);await clean(root);
});
