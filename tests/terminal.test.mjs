import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyCommand,redactSecrets,shouldPersistHistory} from '../desktop/terminal-policy.mjs';
import {TerminalManager} from '../desktop/terminal-manager.mjs';

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
 assert.match(main,/terminalManager\?\.killAll/);
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
 assert.match(manager,/this\.sessions\.size>=MAX_TERMINAL_SESSIONS/);
 assert.match(manager,/async resolveProfile\(profile\)/);
 assert.match(manager,/if\(profile\)terminal\.write\(executableLine/);
 assert.doesNotMatch(manager,/options\.startupCommand/);
 assert.match(ui,/profile:kind/);
 assert.doesNotMatch(ui,/startupCommand/);
 assert.match(manager,/Set-Location -LiteralPath/);
 assert.match(manager,/\.humanale','cli-hub\.json/);
 assert.match(manager,/\.dudiddam','cli-hub\.json/);
 assert.match(ui,/terminalRecent/);
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
 manager.killAll();
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
