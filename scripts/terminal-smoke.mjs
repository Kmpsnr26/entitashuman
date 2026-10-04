import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertPackagedPty} from './terminal-package-check.mjs';

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
 if(!/HUMANALE GOD ENGINE CMD OK/i.test(output))throw new Error('Output echo PTY tidak ditemukan.');
 if(!/git(?:\.exe)?/i.test(output))throw new Error('Git tidak ditemukan melalui CMD PTY.');
 const stopped=manager.list().find(item=>item.id===session.id);
 if(!stopped||stopped.status!=='stopped')throw new Error('Sesi PTY yang selesai harus tetap tersedia untuk Restart.');
 const restarted=await manager.restart(session.id);
 if(!restarted?.pid||restarted.id===session.id||restarted.status!=='running')throw new Error('Restart PTY tidak membuat sesi baru yang aktif.');
 const restartedExited=waitForExit(restarted.id);
 manager.kill(restarted.id);
 const restartTimeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PTY restart tidak berhenti dalam 12 detik.')),12000);});
 const restartedEnded=await Promise.race([restartedExited,restartTimeout]);
 clearTimeout(timer);
 if(restartedEnded.id!==restarted.id)throw new Error('Exit sesi restart tidak cocok.');
 if(manager.list().length)throw new Error('Sesi PTY tidak bersih setelah ditutup eksplisit.');
 manager.killAll();
 await new Promise((resolve,reject)=>process.stdout.write('HumanALE god egine terminal PTY smoke passed: CMD interactive input, realtime output, Git PATH, stopped-session recovery, restart, and confirmed process exit.\n',error=>error?reject(error):resolve()));
 process.exit(0);
}catch(error){
 clearTimeout(timer);
 try{manager?.killAll();}catch{}
 console.error('HumanALE god egine terminal PTY smoke failed:',error);
 process.exit(1);
}
