import {accessSync,constants,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

const windows=process.platform==='win32';
const executable=candidate=>{
 try{accessSync(candidate,constants.X_OK);return statSync(candidate).isFile();}catch{return false;}
};
const fromPath=(name)=>(process.env.PATH||'').split(path.delimiter)
 .map(directory=>path.join(directory,name)).find(executable);
// An explicit override is tested as supplied: an invalid launcher must fail,
// rather than silently turning requested coverage into a skipped test.
export const powershellCommand=process.env.HUMANALE_POWERSHELL||
 (windows?'powershell.exe':fromPath('pwsh'));
export const powershellSkip=powershellCommand?false:
 'PowerShell is unavailable; install PowerShell 7 or set HUMANALE_POWERSHELL to run script logic tests.';

export function powershellEnv(extra={}){
 const env={...process.env,...extra};
 if(windows&&/^powershell(?:\.exe)?$/i.test(path.basename(powershellCommand||''))){
  env.PSModulePath=path.join(process.env.SystemRoot||'C:\\Windows',
   'System32','WindowsPowerShell','v1.0','Modules');
 }else{
  // Let pwsh discover its own cross-platform modules rather than inheriting
  // a Windows PowerShell module path from the Node test runner.
  delete env.PSModulePath;
  if(!windows){
   env.XDG_CACHE_HOME ||= path.join(tmpdir(),'humanale-powershell-cache');
   env.XDG_CONFIG_HOME ||= path.join(tmpdir(),'humanale-powershell-config');
   env.XDG_DATA_HOME ||= path.join(tmpdir(),'humanale-powershell-data');
  }
 }
 return env;
}

export function writeNodeCommandShim(directory,name,script){
 const shim=path.join(directory,name+(windows?'.cmd':''));
 const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
 const content=windows?
  `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`:
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`;
 writeFileSync(shim,content,{mode:0o755});
 return shim;
}
