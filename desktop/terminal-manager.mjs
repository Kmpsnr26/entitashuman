import {readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {redactSecrets} from './terminal-policy.mjs';

const MAX_TERMINAL_SESSIONS=12;
const DEFAULT_STOP_TIMEOUT_MS=5000;

let ptyModulePromise=null;
async function loadDesktopPty(){
 if(process.platform!=='win32')throw new Error('Terminal PTY HumanALE hanya tersedia pada desktop Windows.');
 if(!ptyModulePromise){
  ptyModulePromise=import('node-pty').then(module=>module.default??module).catch(error=>{
   ptyModulePromise=null;
   throw new Error('node-pty desktop tidak tersedia: '+error.message);
  });
 }
 return ptyModulePromise;
}

function waitForSessionExit(session,timeoutMs){
 if(session.exitEvent)return Promise.resolve(session.exitEvent);
 return new Promise((resolvePromise,rejectPromise)=>{
  const timer=setTimeout(()=>rejectPromise(new Error('Terminal '+session.id+' belum mengonfirmasi proses berhenti dalam '+timeoutMs+' ms.')),timeoutMs);
  session.exitPromise.then(result=>{clearTimeout(timer);resolvePromise(result);});
 });
}

const SHELLS={
 pwsh:{label:'PowerShell 7',commands:['pwsh.exe','pwsh']},
 powershell:{label:'Windows PowerShell',commands:['powershell.exe','powershell']},
 cmd:{label:'Command Prompt',commands:['cmd.exe','cmd']}
};
const CLI_DEFAULTS={claude:'claude',codex:'codex',cursor:'agent',gemini:'gemini',git:'git',gh:'gh',node:'node',npm:'npm',npx:'npx',python:'python',pip:'pip'};
const CLI_LABELS={claude:'Claude Code',codex:'OpenAI Codex',cursor:'Cursor',gemini:'Gemini CLI',git:'Git',gh:'GitHub CLI',node:'Node.js',npm:'npm',npx:'npx',python:'Python',pip:'pip'};

function locateCommand(command){
 return new Promise(resolvePromise=>{
  const finder=process.platform==='win32'?'where.exe':'which';
  const child=spawn(finder,[command],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let out='';child.stdout.on('data',chunk=>out+=chunk);
  child.on('error',()=>resolvePromise(null));
  child.on('close',code=>resolvePromise(code===0?out.split(/\r?\n/).map(x=>x.trim()).find(Boolean)||null:null));
 });
}
async function isDirectory(path){try{return (await stat(path)).isDirectory();}catch{return false;}}
async function readHubConfig(){
 const candidates=[join(homedir(),'.humanale','cli-hub.json'),join(homedir(),'.dudiddam','cli-hub.json')];
 for(const path of candidates){
  try{const parsed=JSON.parse(await readFile(path,'utf8'));if(parsed&&typeof parsed==='object')return parsed;}catch{}
 }
 return {};
}
function cleanTitle(value,fallback){const text=String(value||fallback).replace(/[\r\n\t]/g,' ').trim().slice(0,80);return text||fallback;}
function cleanSize(value,fallback,min,max){const n=Math.round(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function executableLine(shell,executable){
 const value=String(executable||'');
 if(shell==='cmd')return '"'+value.replace(/"/g,'')+'"';
 return "& '"+value.replace(/'/g,"''")+"'";
}
function powershellLiteral(value){return "'"+String(value).replace(/'/g,"''")+"'";}

export class TerminalManager{
 constructor({workspace=process.cwd(),onData=()=>{},onExit=()=>{},commandLocator=locateCommand,ptyLoader=loadDesktopPty,stopTimeoutMs=DEFAULT_STOP_TIMEOUT_MS}={}){
  this.workspace=resolve(workspace||process.cwd());this.onData=onData;this.onExit=onExit;this.sessions=new Map();this.sequence=0;
  this.commandLocator=commandLocator;this.ptyLoader=ptyLoader;this.pendingCreates=0;
  const timeout=Number(stopTimeoutMs);
  this.stopTimeoutMs=Number.isFinite(timeout)?Math.max(10,Math.min(30000,timeout)):DEFAULT_STOP_TIMEOUT_MS;
 }
 setWorkspace(value){if(value)this.workspace=resolve(String(value));}
 async resolveShell(shell='auto'){
  const order=shell==='auto'?['pwsh','powershell','cmd']:[shell];
  for(const id of order){
   const def=SHELLS[id];if(!def)continue;
   for(const command of def.commands){const found=await this.commandLocator(command);if(found)return {id,label:def.label,executable:found};}
  }
  if(shell!=='auto')return this.resolveShell('auto');
  throw new Error('No supported Windows shell detected.');
 }
 async resolveProfile(profile){
  const id=String(profile||'').trim().toLowerCase();
  if(!Object.hasOwn(CLI_DEFAULTS,id))throw new Error('Profil CLI terminal tidak dikenali.');
  const hub=await readHubConfig(),providers=hub?.providers&&typeof hub.providers==='object'?hub.providers:{},configured=providers[id];
  if(configured?.enabled===false)throw new Error((CLI_LABELS[id]||id)+' dinonaktifkan di CLI Hub.');
  const command=String(configured?.command||CLI_DEFAULTS[id]).trim();
  const executable=command?await this.commandLocator(command):null;
  if(!executable)throw new Error((CLI_LABELS[id]||id)+' belum terpasang atau tidak ditemukan di PATH.');
  return {id,label:CLI_LABELS[id]||id,executable};
 }
 async resolveCwd(cwd){
  const target=cwd?resolve(String(cwd)):this.workspace;
  if(!isAbsolute(target)||!await isDirectory(target))throw new Error('Folder kerja terminal tidak ditemukan.');
  return target;
 }
 async create(options={}, {replacingSessionId}={}){
  const replacementKey=replacingSessionId?String(replacingSessionId):null;
  const replacingSession=replacementKey?this.sessions.get(replacementKey):null;
  const replacingStoppedSession=replacingSession?.status==='stopped';
  if(this.sessions.size+this.pendingCreates-(replacingStoppedSession?1:0)>=MAX_TERMINAL_SESSIONS){
   throw new Error('Batas '+MAX_TERMINAL_SESSIONS+' sesi terminal tercapai. Tutup sesi yang tidak dipakai sebelum membuka sesi baru.');
  }
  this.pendingCreates+=1;
  try{
   let shell=await this.resolveShell(options.shell||'auto');
   const profile=options.profile?await this.resolveProfile(options.profile):null;
   const cwd=await this.resolveCwd(options.cwd);
   const cols=cleanSize(options.cols,120,20,400),rows=cleanSize(options.rows,30,5,200);
   const id='term-'+Date.now().toString(36)+'-'+(++this.sequence).toString(36);
   const pty=await this.ptyLoader();
   const spawnOptions={name:'xterm-256color',cols,rows,cwd,env:{...process.env,TERM:'xterm-256color'}};
   let terminal;
   try{
    terminal=pty.spawn(shell.executable,[],spawnOptions);
   }catch(error){
    if((options.shell||'auto')==='auto')throw new Error('Terminal PTY tidak dapat dibuat: '+error.message);
    try{
     shell=await this.resolveShell('auto');
     terminal=pty.spawn(shell.executable,[],spawnOptions);
    }catch(fallbackError){
     throw new Error('Terminal PTY tidak dapat dibuat: '+fallbackError.message+' (fallback awal: '+error.message+')');
    }
   }
   let resolveExit;
   const exitPromise=new Promise(resolvePromise=>{resolveExit=resolvePromise;});
   const session={id,shell:shell.id,shellLabel:shell.label,cwd,pid:terminal.pid,title:cleanTitle(options.title,profile?.label||shell.label),profile:profile?.id||null,status:'running',terminal,recent:'',exitPromise,resolveExit,exitEvent:null,killRequested:false,stopPromise:null,restartPromise:null};
   terminal.onData(data=>{session.recent=(session.recent+String(data)).slice(-60000);this.onData(id,String(data));});
   terminal.onExit(({exitCode,signal})=>{
    if(session.status==='stopped')return;
    session.status='stopped';session.exitCode=Number.isInteger(exitCode)?exitCode:null;session.signal=signal??null;
    session.exitEvent={exitCode:session.exitCode,signal:session.signal};
    session.resolveExit(session.exitEvent);
    try{this.onExit(id,session.exitCode);}catch(error){console.warn('[TERMINAL EXIT CALLBACK]',error?.message||'Exit callback failed.');}
   });
   if(profile)terminal.write(executableLine(shell.id,profile.executable)+'\r');
   if(replacingStoppedSession&&this.sessions.get(replacementKey)===replacingSession){
    this.sessions.delete(replacementKey);
   }
   this.sessions.set(id,session);
   return this.publicSession(session);
  }finally{
   this.pendingCreates-=1;
  }
 }
 publicSession(session){return {id:session.id,shell:session.shell,shellLabel:session.shellLabel,cwd:session.cwd,pid:session.pid,title:session.title,profile:session.profile||null,status:session.status,exitCode:session.exitCode??null};}
 list(){return [...this.sessions.values()].map(session=>this.publicSession(session));}
 write(id,data){const session=this.sessions.get(String(id));if(!session)throw new Error('Sesi terminal tidak ditemukan.');if(session.status!=='running')throw new Error('Sesi terminal sudah berhenti. Gunakan Restart untuk menjalankannya kembali.');const value=String(data??'');if(value.length>32000)throw new Error('Input terminal terlalu besar.');session.terminal.write(value);return {ok:true};}
 resize(id,cols,rows){const session=this.sessions.get(String(id));if(!session)throw new Error('Sesi terminal tidak ditemukan.');if(session.status!=='running')return {ok:true,stopped:true};session.terminal.resize(cleanSize(cols,120,20,400),cleanSize(rows,30,5,200));return {ok:true};}
 async kill(id,{timeoutMs=this.stopTimeoutMs,remove=true}={}){
  const key=String(id),session=this.sessions.get(key);
  if(!session)return {ok:true,missing:true};
  if(session.status==='stopped'){
   if(remove&&this.sessions.get(key)===session)this.sessions.delete(key);
   return {ok:true,stopped:true,alreadyStopped:true,exitCode:session.exitCode??null};
  }
  if(!session.stopPromise){
   const timeout=Number.isFinite(Number(timeoutMs))?Math.max(10,Math.min(30000,Number(timeoutMs))):this.stopTimeoutMs;
   session.stopPromise=(async()=>{
    if(!session.killRequested){
     session.killRequested=true;
     session.terminal.kill();
    }
    const exit=await waitForSessionExit(session,timeout);
    return {ok:true,stopped:true,exitCode:exit.exitCode??null};
   })();
  }
  const pending=session.stopPromise;
  try{
   const result=await pending;
   if(remove&&this.sessions.get(key)===session)this.sessions.delete(key);
   return result;
  }catch(error){
   if(session.stopPromise===pending)session.stopPromise=null;
   throw error;
  }
 }
 async restart(id){
  const key=String(id),session=this.sessions.get(key);
  if(!session)throw new Error('Sesi terminal tidak ditemukan.');
  if(session.restartPromise)return session.restartPromise;
  const options={shell:session.shell,cwd:session.cwd,title:session.title,profile:session.profile||undefined};
  session.restartPromise=(async()=>{
   await this.kill(key,{remove:false});
   return this.create(options,{replacingSessionId:key});
  })();
  try{return await session.restartPromise;}
  catch(error){session.restartPromise=null;throw error;}
 }
 clear(id){const session=this.sessions.get(String(id));if(!session)throw new Error('Sesi terminal tidak ditemukan.');if(session.status==='running')session.terminal.write('\x1bc');session.recent='';return {ok:true};}
 async setCwd(id,cwd){
  const session=this.sessions.get(String(id));if(!session)throw new Error('Sesi terminal tidak ditemukan.');if(session.status!=='running')throw new Error('Sesi terminal sudah berhenti.');
  const raw=String(cwd||'').replace(/[\r\n]/g,'').trim();if(!raw)throw new Error('Folder kerja tidak valid.');
  const target=isAbsolute(raw)?resolve(raw):resolve(session.cwd,raw);
  if(!await isDirectory(target))throw new Error('Folder kerja terminal tidak ditemukan.');
  const command=session.shell==='cmd'?'cd /d "'+target.replace(/"/g,'')+'"':'Set-Location -LiteralPath '+powershellLiteral(target);
  session.terminal.write(command+'\r');session.cwd=target;return {ok:true,cwd:target};
 }
 getRecentOutput(id,limit=12000){const session=this.sessions.get(String(id));if(!session)return '';return redactSecrets(session.recent.slice(-Math.max(500,Math.min(30000,Number(limit)||12000))));}
 async detect(){
  const hub=await readHubConfig(),providers=hub?.providers&&typeof hub.providers==='object'?hub.providers:{},registry={};
  for(const [id,defaultCommand] of Object.entries(CLI_DEFAULTS)){
   const configured=providers[id];
   if(configured&&configured.enabled===false){registry[id]={id,label:CLI_LABELS[id]||id,command:configured.command||defaultCommand,state:'DISABLED',path:null};continue;}
   const command=String(configured?.command||defaultCommand).trim(),found=command?await this.commandLocator(command):null;
   registry[id]={id,label:CLI_LABELS[id]||id,command,state:found?'READY':'NOT INSTALLED',path:found||null};
  }
  const shells={};
  for(const id of Object.keys(SHELLS)){let found=null;for(const command of SHELLS[id].commands){found=await this.commandLocator(command);if(found)break;}shells[id]={id,label:SHELLS[id].label,state:found?'READY':'NOT FOUND',path:found};}
  return {workspace:this.workspace,shells,registry};
 }
 async killAll({timeoutMs=this.stopTimeoutMs}={}){
  const ids=[...this.sessions.keys()];
  const results=await Promise.allSettled(ids.map(id=>this.kill(id,{timeoutMs})));
  const failures=results.map((result,index)=>({result,id:ids[index]})).filter(item=>item.result.status==='rejected');
  if(failures.length){
   const details=failures.map(item=>item.id+': '+(item.result.reason?.message||'Unknown shutdown error')).join('; ');
   throw new Error('Gagal menghentikan '+failures.length+' sesi terminal: '+details);
  }
  return {ok:true,closed:ids.length};
 }
}
