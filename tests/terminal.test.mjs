import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyCommand,redactSecrets,shouldPersistHistory} from '../desktop/terminal-policy.mjs';
import {TerminalManager} from '../desktop/terminal-manager.mjs';
import {setTimeout as delay} from 'node:timers/promises';


class FakeTerminal {
 constructor(){this.killCalls=0;this.exitListener=null;this.dataListener=null;}
 onData(listener){this.dataListener=listener;}
 onExit(listener){this.exitListener=listener;}
 write(value){this.lastWrite=value;}
 resize(cols,rows){this.lastSize={cols,rows};}
 kill(){this.killCalls+=1;}
 exit({exitCode=0,signal=null}={}){this.exitListener?.({exitCode,signal});}
}

function createFakeTerminalManager({stopTimeoutMs=100,failSpawnAt=0}={}){
 const failedSpawns=new Set(Array.isArray(failSpawnAt)?failSpawnAt:[failSpawnAt]);
 const terminals=[];
 let spawnCount=0;
 const manager=new TerminalManager({
  workspace:process.cwd(),
  commandLocator:async command=>command==='pwsh.exe'?'C:\\Fake\\pwsh.exe':null,
  stopTimeoutMs,
  ptyLoader:async()=>({spawn:()=>{
   spawnCount+=1;
   if(failedSpawns.has(spawnCount))throw new Error('simulated PTY spawn failure');
   const terminal=new FakeTerminal();terminals.push(terminal);return terminal;
  }})
 });
 return {manager,terminals,get spawnCount(){return spawnCount;}};
}

test('terminal policy separates SAFE CONFIRM and BLOCK commands',()=>{
 assert.equal(classifyCommand('git status').category,'SAFE');
 assert.equal(classifyCommand('npm run build').category,'CONFIRM');
 assert.equal(classifyCommand('npm test').category,'CONFIRM');
 assert.equal(classifyCommand('git push origin main').category,'CONFIRM');
 assert.equal(classifyCommand('winget install Example.App').category,'CONFIRM');
 assert.equal(classifyCommand('Set-MpPreference -DisableRealtimeMonitoring $true').category,'BLOCK');
 assert.equal(classifyCommand('cmdkey /list').category,'BLOCK');
 assert.equal(classifyCommand('echo one\necho two').category,'BLOCK');
 assert.equal(classifyCommand('git status; echo chained').category,'CONFIRM');
 assert.equal(classifyCommand('git status && echo chained').category,'CONFIRM');
 assert.equal(classifyCommand('git status | findstr main').category,'CONFIRM');
 assert.equal(classifyCommand('git status > status.txt').category,'CONFIRM');
 assert.equal(classifyCommand('git status $(echo injected)').category,'CONFIRM');
 assert.equal(classifyCommand('Get-Content $env:USERPROFILE\\.ssh\\id_rsa').category,'CONFIRM');
 assert.equal(classifyCommand('type %USERPROFILE%\\.ssh\\id_rsa').category,'CONFIRM');
 assert.equal(classifyCommand('cd C:\\Users').category,'CONFIRM');
 assert.equal(classifyCommand('Resolve-Path C:\\Users').category,'CONFIRM');
 assert.equal(classifyCommand('Get-ChildItem').category,'SAFE');
 assert.equal(classifyCommand('Get-ChildItem C:\\Users').category,'CONFIRM');
 assert.equal(classifyCommand('echo %OPENAI_API_KEY%').category,'BLOCK');
 assert.equal(classifyCommand('echo %MY_SERVICE_TOKEN%').category,'BLOCK');
 assert.equal(classifyCommand('echo $env:ANTHROPIC_API_KEY').category,'BLOCK');
 assert.equal(classifyCommand('echo %USERPROFILE%').category,'SAFE');
});

test('terminal redaction removes common credentials before AI or logs',()=>{
 const value='OPENAI_API_KEY=sk-test-secret Authorization: Bearer abc.def.ghi password=hunter2 token=abc123 github_pat_1234567890abcdefghijklmnop sk-ant-abcdefghijklmnop';
 const redacted=redactSecrets(value);
 assert.doesNotMatch(redacted,/sk-test-secret|abc\.def\.ghi|hunter2|abc123|github_pat_|sk-ant-/);
 assert.match(redacted,/\[REDACTED\]/);
 const quoted=redactSecrets('password="two words" token=\'quoted value\' {"token":"json secret","authorization":"Bearer json-secret"}');
 assert.doesNotMatch(quoted,/two words|quoted value|json secret|json-secret/);
 assert.match(quoted,/password="\[REDACTED\]"/);
 assert.match(quoted,/"token":"\[REDACTED\]"/);
 assert.equal(shouldPersistHistory('git status'),true);
 assert.equal(shouldPersistHistory('set token=abc'),false);
});

test('terminal renderer and preload keep Node APIs behind bounded IPC',async()=>{
 const [preload,main,html,ui,pkg,portable]=await Promise.all([
  readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),
  readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8'),
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/terminal-ui.js',import.meta.url),'utf8'),
  readFile(new URL('../package.json',import.meta.url),'utf8'),
  readFile(new URL('../package-desktop.mjs',import.meta.url),'utf8')
 ]);
 assert.match(main,/nodeIntegration:false/);
 assert.match(main,/contextIsolation:true/);
 assert.match(main,/sandbox:true/);
 assert.match(main,/dudidam:terminal-create/);
 assert.match(main,/dudidam:terminal-execute/);
 assert.match(main,/Konfirmasi command HumanALE god egine/);
 assert.doesNotMatch(main,/decision\.category==='CONFIRM'&&!value\?\.confirmed/);
 assert.match(main,/return await terminalManager\.setCwd/);
 assert.match(main,/vendor\/xterm\.js/);
 assert.match(preload,/terminalCreate/);
 assert.match(preload,/onTerminalData/);
 assert.doesNotMatch(preload,/require:\s*require|child_process|node-pty/);
 assert.match(html,/id="terminalDialog"/);
 assert.match(ui,/\/vendor\/xterm\.js/);
 assert.match(ui,/new window\.Terminal/);
 assert.match(ui,/FitAddon/);
 assert.match(ui,/terminalResize/);
 assert.match(ui,/\/run/);
 assert.match(ui,/terminalExecute/);
 assert.doesNotMatch(ui,/needsConfirmation|command,true/);
 assert.match(main,/terminalShutdownPromise=terminalManager\.killAll\(\)/);
 assert.match(main,/await terminalManager\.kill\(value\?\.sessionId\)/);
 assert.match(main,/Terminal belum berhenti/);
 assert.doesNotMatch(main,/terminalManager\?\.killAll\?\.\(\)/);
 assert.match(pkg,/"node-pty": "1\.1\.0"/);
 assert.match(pkg,/"@xterm\/xterm": "6\.0\.0"/);
 assert.match(portable,/node-pty/);
 assert.match(portable,/@xterm/);
});

test('terminal startup is restricted to detected CLI profiles and cannot accept raw startup commands',async()=>{
 const [manager,ui]=await Promise.all([
  readFile(new URL('../desktop/terminal-manager.mjs',import.meta.url),'utf8'),
  readFile(new URL('../public/terminal-ui.js',import.meta.url),'utf8')
 ]);
 assert.match(manager,/MAX_TERMINAL_SESSIONS=12/);
 assert.match(manager,/this\.sessions\.size\+this\.pendingCreates-\(replacingStoppedSession\?1:0\)>=MAX_TERMINAL_SESSIONS/);
 assert.match(manager,/this\.pendingCreates\+=1/);
 assert.match(manager,/replacingSessionId:key/);
 assert.match(manager,/async kill\(/);
 assert.match(manager,/session\.killRequested/);
 assert.match(manager,/async killAll\(/);
 assert.match(manager,/async resolveProfile\(profile\)/);
 assert.match(manager,/if\(profile\)terminal\.write\(executableLine/);
 assert.doesNotMatch(manager,/options\.startupCommand/);
 assert.match(ui,/profile:kind/);
 assert.doesNotMatch(ui,/startupCommand/);
 assert.match(manager,/Set-Location -LiteralPath/);
 assert.match(manager,/\.humanale','cli-hub\.json/);
 assert.match(manager,/\.dudiddam','cli-hub\.json/);
 assert.match(ui,/terminalRecent/);
 assert.match(ui,/Terminal belum dapat ditutup/);
 assert.match(ui,/terminalList/);
});

test('TerminalManager detects actual available shells and developer CLIs without failing',async()=>{
 const manager=new TerminalManager({workspace:process.cwd()});
 const detection=await manager.detect();
 assert.equal(detection.workspace,process.cwd());
 assert.ok(['READY','NOT FOUND'].includes(detection.shells.pwsh.state));
 if(process.platform==='win32')assert.equal(detection.shells.cmd.state,'READY');
 for(const shell of Object.values(detection.shells)){
  assert.ok(['READY','NOT FOUND'].includes(shell.state));
  assert.equal(Boolean(shell.path),shell.state==='READY');
 }
 for(const id of ['claude','codex','cursor','gemini','git','gh','node','npm','python']){
  assert.ok(detection.registry[id]);
  assert.ok(['READY','NOT INSTALLED','DISABLED'].includes(detection.registry[id].state));
  assert.equal(Boolean(detection.registry[id].path),detection.registry[id].state==='READY');
 }
 await manager.killAll();
});

test('TerminalManager resolves fallback shell paths without executing Windows binaries',async()=>{
 const calls=[];
 const cmd='C:\\Windows\\System32\\cmd.exe';
 const manager=new TerminalManager({commandLocator:async command=>{calls.push(command);return command==='cmd.exe'?cmd:null;}});
 assert.deepEqual(await manager.resolveShell('pwsh'),{id:'cmd',label:'Command Prompt',executable:cmd});
 assert.deepEqual(calls,['pwsh.exe','pwsh','pwsh.exe','pwsh','powershell.exe','powershell','cmd.exe']);
 const detection=await manager.detect();
 assert.equal(detection.shells.cmd.path,cmd);
 assert.equal(detection.shells.cmd.state,'READY');
 assert.equal(detection.shells.pwsh.state,'NOT FOUND');
 assert.equal(manager.list().length,0);
});

test('TerminalManager prefers PowerShell 7 and reports no supported shell when discovery fails',async()=>{
 const calls=[];
 const pwsh='C:\\Program Files\\PowerShell\\7\\pwsh.exe';
 const manager=new TerminalManager({commandLocator:async command=>{calls.push(command);return command==='pwsh.exe'?pwsh:null;}});
 assert.deepEqual(await manager.resolveShell(),{id:'pwsh',label:'PowerShell 7',executable:pwsh});
 assert.deepEqual(calls,['pwsh.exe']);
 const missing=new TerminalManager({commandLocator:async()=>null});
 await assert.rejects(missing.resolveShell(),/No supported Windows shell detected/);
 await assert.rejects(missing.resolveShell('cmd'),/No supported Windows shell detected/);
});


test('TerminalManager kill is idempotent and waits for the native exit event',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const session=await manager.create({shell:'auto'});
 const terminal=terminals[0];
 const first=manager.kill(session.id);
 const second=manager.kill(session.id);
 let settled=false;
 first.then(()=>{settled=true;});
 await delay(15);
 assert.equal(terminal.killCalls,1);
 assert.equal(manager.list().length,1);
 assert.equal(settled,false);
 terminal.exit({exitCode:0});
 const [a,b]=await Promise.all([first,second]);
 assert.equal(a.ok,true);
 assert.equal(b.ok,true);
 assert.equal(manager.list().length,0);
});

test('TerminalManager stop timeout keeps the session and never repeats native kill',async()=>{
 const {manager,terminals}=createFakeTerminalManager({stopTimeoutMs:20});
 const session=await manager.create({shell:'auto'});
 const terminal=terminals[0];
 await assert.rejects(manager.kill(session.id),/belum mengonfirmasi proses berhenti/);
 assert.equal(terminal.killCalls,1);
 assert.equal(manager.list().length,1);
 assert.equal(manager.list()[0].status,'running');
 const retry=manager.kill(session.id,{timeoutMs:200});
 await delay(5);
 assert.equal(terminal.killCalls,1);
 terminal.exit({exitCode:0});
 await retry;
 assert.equal(manager.list().length,0);
});

test('TerminalManager restart waits for exit before creating a replacement session',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const session=await manager.create({shell:'auto'});
 const firstTerminal=terminals[0];
 const restart=manager.restart(session.id);
 await delay(15);
 assert.equal(terminals.length,1);
 assert.equal(firstTerminal.killCalls,1);
 firstTerminal.exit({exitCode:0});
 const replacement=await restart;
 assert.notEqual(replacement.id,session.id);
 assert.equal(replacement.status,'running');
 assert.equal(terminals.length,2);
 assert.deepEqual(manager.list().map(item=>item.id),[replacement.id]);
});

test('TerminalManager concurrent restarts share one replacement operation',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const session=await manager.create({shell:'auto'});
 const first=manager.restart(session.id);
 const second=manager.restart(session.id);
 await delay(15);
 assert.equal(terminals.length,1);
 terminals[0].exit({exitCode:0});
 const [a,b]=await Promise.all([first,second]);
 assert.equal(a.id,b.id);
 assert.equal(terminals.length,2);
 assert.deepEqual(manager.list().map(item=>item.id),[a.id]);
});

test('TerminalManager restart preserves the stopped session when replacement spawn fails',async()=>{
 const {manager,terminals}=createFakeTerminalManager({failSpawnAt:[2,3]});
 const session=await manager.create({shell:'auto'});
 const restart=manager.restart(session.id);
 await delay(10);
 terminals[0].exit({exitCode:0});
 await assert.rejects(restart,/simulated PTY spawn failure/);
 assert.equal(manager.list().length,1);
 assert.equal(manager.list()[0].id,session.id);
 assert.equal(manager.list()[0].status,'stopped');
 const replacement=await manager.restart(session.id);
 assert.equal(replacement.status,'running');
 assert.equal(manager.list().length,1);
});

test('TerminalManager killAll waits for every session and reports completed cleanup',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const first=await manager.create({shell:'auto'});
 const second=await manager.create({shell:'auto'});
 const closing=manager.killAll();
 let settled=false;
 closing.then(()=>{settled=true;});
 await delay(15);
 assert.equal(terminals[0].killCalls,1);
 assert.equal(terminals[1].killCalls,1);
 terminals[0].exit({exitCode:0});
 await delay(10);
 assert.equal(settled,false);
 terminals[1].exit({exitCode:0});
 const result=await closing;
 assert.deepEqual(result,{ok:true,closed:2});
 assert.equal(manager.list().length,0);
 assert.equal(first.status,'running');
 assert.equal(second.status,'running');
});


test('TerminalManager reserves its 12-session limit across concurrent creates',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const requests=Array.from({length:13},()=>manager.create({shell:'auto'}));
 const results=await Promise.allSettled(requests);
 const fulfilled=results.filter(result=>result.status==='fulfilled');
 const rejected=results.filter(result=>result.status==='rejected');
 assert.equal(fulfilled.length,12);
 assert.equal(rejected.length,1);
 assert.match(rejected[0].reason.message,/Batas 12 sesi terminal/);
 assert.equal(manager.pendingCreates,0);
 assert.equal(manager.list().length,12);
 const closing=manager.killAll();
 await delay(10);
 terminals.forEach(terminal=>terminal.exit({exitCode:0}));
 await closing;
 assert.equal(manager.list().length,0);
});

test('TerminalManager restart reuses its existing slot when all 12 sessions are retained',async()=>{
 const {manager,terminals}=createFakeTerminalManager();
 const sessions=[];
 for(let i=0;i<12;i++)sessions.push(await manager.create({shell:'auto'}));
 assert.equal(manager.list().length,12);
 const restart=manager.restart(sessions[0].id);
 await delay(10);
 assert.equal(terminals.length,12);
 assert.equal(terminals[0].killCalls,1);
 terminals[0].exit({exitCode:0});
 const replacement=await restart;
 assert.notEqual(replacement.id,sessions[0].id);
 assert.equal(manager.list().length,12);
 assert.equal(manager.list().some(item=>item.id===sessions[0].id),false);
 assert.equal(manager.list().some(item=>item.id===replacement.id),true);
 const closing=manager.killAll();
 await delay(10);
 terminals.forEach(terminal=>terminal.exit({exitCode:0}));
 await closing;
 assert.equal(manager.list().length,0);
});
