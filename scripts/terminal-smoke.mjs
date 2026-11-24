import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertPackagedPty} from './terminal-package-check.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function isOwnedChildAlive(pid,scriptPath){
 const escaped=scriptPath.replace(/'/g,"''");
 const command="$p=Get-CimInstance Win32_Process -Filter 'ProcessId = "+Number(pid)+"'; if($p -and $p.CommandLine -and $p.CommandLine.Contains('"+escaped+"')){Write-Output 'ALECORE_PTY_CHILD_ALIVE'}";
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:8000});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error('Windows process ownership probe failed: '+String(result.stderr||result.stdout||result.status).trim());
 return String(result.stdout||'').includes('ALECORE_PTY_CHILD_ALIVE');
}

async function smokeChildProcessCleanup(manager){
 const directory=await mkdtemp(join(tmpdir(),'alecore-pty-child-smoke-'));
 const scriptPath=join(directory,'child.cjs');
 const markerPath=join(directory,'child.json');
 let session=null,child=null,primaryFailure=null;
 const childSource=[
  "const fs=require('node:fs');",
  "const marker=process.argv[2];",
  "if(!marker)process.exit(2);",
  "fs.writeFileSync(marker,JSON.stringify({pid:process.pid,script:__filename,startedAt:Date.now()}));",
  "setTimeout(()=>process.exit(0),30000);"
 ].join("\n");
 try{
  await writeFile(scriptPath,childSource,'utf8');
  session=await manager.create({shell:'cmd',cols:100,rows:30,title:'AleCore PTY child cleanup smoke'});
  const command='"'+process.execPath.replace(/"/g,'')+'" "'+scriptPath.replace(/"/g,'')+'" "'+markerPath.replace(/"/g,'')+'"';
  manager.write(session.id,command+'\r');

  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
   try{
    child=JSON.parse(await readFile(markerPath,'utf8'));
    if(Number.isInteger(child.pid)&&child.pid>0)break;
   }catch{}
   await delay(60);
  }
  if(!child?.pid)throw new Error('Child process marker was not created by the CMD PTY.');
  if(!isOwnedChildAlive(child.pid,scriptPath))throw new Error('Child process was not alive before PTY shutdown.');

  await manager.kill(session.id);
  await delay(750);

  if(isOwnedChildAlive(child.pid,scriptPath)){
   throw new Error('Windows PTY shutdown left its owned child process running (PID '+child.pid+').');
  }
 }catch(error){
  primaryFailure=error;
 }finally{
  if(child?.pid){
   try{
    if(isOwnedChildAlive(child.pid,scriptPath)){
     const cleanup=spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:10000});
     if(cleanup.error)throw cleanup.error;
     await delay(250);
     if(isOwnedChildAlive(child.pid,scriptPath))throw new Error('Test-owned child PID '+child.pid+' could not be cleaned up.');
    }
   }catch(cleanupError){
    if(!primaryFailure)primaryFailure=cleanupError;
    else console.error('[PTY CHILD CLEANUP]',cleanupError?.message||'Owned child cleanup failed.');
   }
  }
  if(session&&manager.list().some(item=>item.id===session.id)){
   try{await manager.kill(session.id);}catch(cleanupError){
    if(!primaryFailure)primaryFailure=cleanupError;
    else console.error('[PTY SESSION CLEANUP]',cleanupError?.message||'PTY session cleanup failed.');
   }
  }
  await rm(directory,{recursive:true,force:true});
 }
 if(primaryFailure)throw primaryFailure;
}

if(process.platform!=='win32'){
 console.log('Terminal PTY smoke skipped: Windows only.');
 process.exit(0);
}

let output='',manager,session,timer;
try{
 const managerArgument=process.argv.indexOf('--manager-path');
 if(managerArgument!==-1&&!process.argv[managerArgument+1])throw new Error('--manager-path requires the packaged terminal-manager.mjs path.');
 const managerUrl=managerArgument===-1?new URL('../desktop/terminal-manager.mjs',import.meta.url):pathToFileURL(resolve(process.argv[managerArgument+1]));
 if(managerArgument!==-1)await assertPackagedPty(managerUrl);
 const {TerminalManager}=await import(managerUrl.href);
 const completed=new Map(),waiters=new Map();
 const waitForExit=id=>completed.has(id)?Promise.resolve(completed.get(id)):new Promise(resolve=>waiters.set(id,resolve));
 manager=new TerminalManager({
   workspace:process.cwd(),
   onData:(_id,data)=>{output+=String(data);},
   onExit:(id,exitCode)=>{const result={id,exitCode};completed.set(id,result);waiters.get(id)?.(result);waiters.delete(id);}
 });
 session=await manager.create({shell:'cmd',cols:100,rows:30,title:'HumanALE god egine CI CMD'});
 if(session.shell!=='cmd'||!session.pid)throw new Error('CMD PTY tidak berjalan.');
 manager.write(session.id,'echo HUMANALE GOD ENGINE CMD OK\r');
 manager.write(session.id,'where git\r');
 manager.write(session.id,'exit\r');
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PTY Windows tidak selesai dalam 12 detik.')),12000);});
 const ended=await Promise.race([waitForExit(session.id),timeout]);
 clearTimeout(timer);
 if(ended.id!==session.id)throw new Error('Sesi PTY yang selesai tidak cocok.');
 if(ended.exitCode!==0)throw new Error('CMD PTY exit code harus 0.');
 await smokeChildProcessCleanup(manager);
 if(!/HUMANALE GOD ENGINE CMD OK/i.test(output))throw new Error('Output echo PTY tidak ditemukan.');
 if(!/git(?:\.exe)?/i.test(output))throw new Error('Git tidak ditemukan melalui CMD PTY.');
 const stopped=manager.list().find(item=>item.id===session.id);
 if(!stopped||stopped.status!=='stopped')throw new Error('Sesi PTY yang selesai harus tetap tersedia untuk Restart.');
 const restarted=await manager.restart(session.id);
 if(!restarted?.pid||restarted.id===session.id||restarted.status!=='running')throw new Error('Restart PTY tidak membuat sesi baru yang aktif.');
 const restartedExited=waitForExit(restarted.id);
 await manager.kill(restarted.id);
 const restartTimeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PTY restart tidak berhenti dalam 12 detik.')),12000);});
 const restartedEnded=await Promise.race([restartedExited,restartTimeout]);
 clearTimeout(timer);
 if(restartedEnded.id!==restarted.id)throw new Error('Exit sesi restart tidak cocok.');
 if(manager.list().length)throw new Error('Sesi PTY tidak bersih setelah ditutup eksplisit.');
 await manager.killAll();
 await new Promise((resolve,reject)=>process.stdout.write('HumanALE god egine terminal PTY smoke passed: CMD interactive input, realtime output, Git PATH, stopped-session recovery, restart, and confirmed PTY exit.\n',error=>error?reject(error):resolve()));
 process.exit(0);
}catch(error){
 clearTimeout(timer);
 try{await manager?.killAll();}catch(cleanupError){console.error('PTY cleanup after smoke failure:',cleanupError?.message||'cleanup failed');}
 console.error('HumanALE god egine terminal PTY smoke failed:',error);
 process.exit(1);
}
