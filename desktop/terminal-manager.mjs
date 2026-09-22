import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {access,readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as pty from 'node-pty';
import {classifyCommand,redactSecrets} from './command-policy.mjs';

const defaultRegistry={
 cursor:{enabled:true,command:'agent',title:'Cursor Agent'},
 claude:{enabled:true,command:'claude',title:'Claude Code'},
 codex:{enabled:true,command:'codex',title:'OpenAI Codex'},
 gemini:{enabled:true,command:'gemini',title:'Gemini CLI'},
 git:{enabled:true,command:'git',title:'Git'},
 gh:{enabled:true,command:'gh',title:'GitHub CLI'},
 node:{enabled:true,command:'node',title:'Node.js'},
 npm:{enabled:true,command:'npm',title:'npm'},
 npx:{enabled:true,command:'npx',title:'npx'},
 python:{enabled:true,command:'python',title:'Python'},
 pip:{enabled:true,command:'pip',title:'pip'}
};

function cleanText(value,max=4000){
 const text=String(value??'').trim();
 if(!text||text.length>max)throw new Error('Nilai terminal tidak valid.');
 return text;
}
function safeNumber(value,min,max,fallback){
 const n=Number(value);
 return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;
}
function sessionView(session){
 return {
  id:session.id,shell:session.shell,cwd:session.cwd,pid:session.pid,
  title:session.title,status:session.status,createdAt:session.createdAt,
  exitCode:Number.isInteger(session.exitCode)?session.exitCode:null
 };
}
async function commandPath(command){
 if(!/^[A-Za-z0-9._-]+$/.test(command))return '';
 const finder=process.platform==='win32'?'where.exe':'which';
 return await new Promise(resolve=>{
  let output='',settled=false;
  const child=spawn(finder,[command],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish('');},2500);
  child.stdout.on('data',chunk=>output=(output+chunk).slice(0,8192));
  child.on('error',()=>finish(''));
  child.on('close',code=>finish(code===0?output.split(/\r?\n/).map(x=>x.trim()).find(Boolean)||'':''));
 });
}

export class TerminalManager extends EventEmitter{
 constructor({workspaceRoot=process.cwd()}={}){
  super();
  this.sessions=new Map();
  this.workspaceRoot=path.resolve(workspaceRoot||process.cwd());
  this.registry=null;
 }
 setWorkspaceRoot(root){
  if(root)this.workspaceRoot=path.resolve(root);
  return this.workspaceRoot;
 }
 async _workspace(){
  try{const info=await stat(this.workspaceRoot);if(info.isDirectory())return this.workspaceRoot;}catch{}
  return process.cwd();
 }
 async _cwd(requested=''){
  const root=await this._workspace();
  if(!requested)return root;
  const resolved=path.resolve(String(requested));
  const relative=path.relative(root,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('CWD harus berada di workspace aktif Dudidam.');
  const info=await stat(resolved);
  if(!info.isDirectory())throw new Error('CWD terminal bukan folder.');
  return resolved;
 }
 async _registry(){
  if(this.registry)return this.registry;
  let config={};
  try{
   config=JSON.parse(await readFile(path.join(homedir(),'.dudiddam','cli-hub.json'),'utf8'));
  }catch{}
  const configured=config?.providers&&typeof config.providers==='object'?config.providers:{};
  this.registry=Object.fromEntries(Object.entries(defaultRegistry).map(([id,item])=>{
   const user=configured[id]&&typeof configured[id]==='object'?configured[id]:{};
   const command=typeof user.command==='string'&&/^[A-Za-z0-9._-]+$/.test(user.command)?user.command:item.command;
   return [id,{...item,...user,command,enabled:user.enabled!==false}];
  }));
  return this.registry;
 }
 async resolveShell(requested='default'){
  const candidates=requested==='pwsh'
   ?[{id:'pwsh',command:'pwsh.exe'}]
   :requested==='powershell'
    ?[{id:'powershell',command:'powershell.exe'}]
    :requested==='cmd'
     ?[{id:'cmd',command:'cmd.exe'}]
     :[{id:'pwsh',command:'pwsh.exe'},{id:'powershell',command:'powershell.exe'},{id:'cmd',command:'cmd.exe'}];
  for(const item of candidates){
   const executable=await commandPath(item.command);
   if(executable)return {...item,path:executable};
  }
  if(requested!=='default')throw new Error('Shell '+requested+' tidak ditemukan pada PATH Windows.');
  throw new Error('No supported Windows shell detected.');
 }
 async detect(){
  const shells={};
  for(const id of ['pwsh','powershell','cmd']){
   try{const item=await this.resolveShell(id);shells[id]={state:'READY',path:item.path};}
   catch{shells[id]={state:'NOT FOUND',path:null};}
  }
  const registry=await this._registry(),clis={};
  for(const [id,item] of Object.entries(registry)){
   if(!item.enabled){clis[id]={state:'DISABLED',command:item.command,title:item.title};continue;}
   const executable=await commandPath(item.command);
   clis[id]={state:executable?'READY':'NOT INSTALLED',command:item.command,path:executable||null,title:item.title};
  }
  return {workspaceRoot:await this._workspace(),shells,clis};
 }
 async create(options={}){
  const profile=typeof options.profile==='string'?options.profile:'';
  const shellInfo=await this.resolveShell(options.shell||'default');
  const cwd=await this._cwd(options.cwd||'');
  let startupCommand='',title=String(options.title||'').trim();
  if(profile){
   const registry=await this._registry(),item=registry[profile];
   if(!item||!item.enabled)throw new Error('CLI profile tidak tersedia.');
   const executable=await commandPath(item.command);
   if(!executable)throw new Error(item.title+' belum terpasang atau tidak ditemukan di PATH.');
   startupCommand=item.command;
   if(!title)title=item.title;
  }
  const id=String(options.id||randomUUID());
  if(this.sessions.has(id))throw new Error('Session terminal sudah ada.');
  const cols=safeNumber(options.cols,20,300,120),rows=safeNumber(options.rows,5,120,30);
  const proc=pty.spawn(shellInfo.path,[],{
   name:'xterm-256color',cols,rows,cwd,
   env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'}
  });
  const session={
   id,shell:shellInfo.id,cwd,pid:proc.pid,title:title||({pwsh:'PowerShell 7',powershell:'Windows PowerShell',cmd:'Command Prompt'}[shellInfo.id]||shellInfo.id),
   status:'running',createdAt:new Date().toISOString(),exitCode:null,proc,recent:'',profile
  };
  this.sessions.set(id,session);
  proc.onData(data=>{
   session.recent=(session.recent+String(data)).slice(-65536);
   this.emit('data',{sessionId:id,data:String(data)});
  });
  proc.onExit(({exitCode})=>{
   if(session.closed)return;
   session.status='stopped';session.exitCode=Number.isInteger(exitCode)?exitCode:null;
   this.emit('exit',{sessionId:id,exitCode:session.exitCode});
  });
  if(startupCommand)setTimeout(()=>{if(this.sessions.has(id))proc.write(startupCommand+'\r');},100);
  this.emit('session',sessionView(session));
  return sessionView(session);
 }
 list(){return [...this.sessions.values()].map(sessionView);}
 write(id,data){
  const session=this.sessions.get(cleanText(id,100));
  if(!session)throw new Error('Session terminal tidak ditemukan.');
  const value=String(data??'');
  if(!value||value.length>32768)throw new Error('Input terminal tidak valid.');
  session.proc.write(value);
  return {ok:true};
 }
 resize(id,cols,rows){
  const session=this.sessions.get(cleanText(id,100));
  if(!session)throw new Error('Session terminal tidak ditemukan.');
  session.proc.resize(safeNumber(cols,20,300,120),safeNumber(rows,5,120,30));
  return {ok:true};
 }
 clear(id){
  const session=this.sessions.get(cleanText(id,100));
  if(!session)throw new Error('Session terminal tidak ditemukan.');
  this.emit('clear',{sessionId:session.id});
  return {ok:true};
 }
 kill(id){
  const key=cleanText(id,100),session=this.sessions.get(key);
  if(!session)return {ok:true};
  session.status='stopped';session.closed=true;
  this.sessions.delete(key);
  try{session.proc.kill();}catch{}
  this.emit('exit',{sessionId:key,exitCode:null});
  return {ok:true};
 }
 async restart(id){
  const key=cleanText(id,100),old=this.sessions.get(key);
  if(!old)throw new Error('Session terminal tidak ditemukan.');
  const options={id:key,shell:old.shell,cwd:old.cwd,title:old.title,profile:old.profile};
  this.kill(key);
  return await this.create(options);
 }
 async setCwd(id,cwd){
  const session=this.sessions.get(cleanText(id,100));
  if(!session)throw new Error('Session terminal tidak ditemukan.');
  const next=await this._cwd(cwd);
  const escaped=next.replace(/'/g,"''");
  if(session.shell==='cmd')session.proc.write('cd /d "'+next.replace(/"/g,'""')+'"\r');
  else session.proc.write("Set-Location -LiteralPath '"+escaped+"'\r");
  session.cwd=next;
  return sessionView(session);
 }
 async runCommand(command,{confirmed=false,cwd=''}={}){
  const text=cleanText(command);
  const policy=classifyCommand(text);
  if(policy.level==='BLOCK')return {ok:false,blocked:true,policy};
  if(policy.level==='CONFIRM'&&!confirmed)return {ok:false,needsConfirmation:true,policy,command:redactSecrets(text)};
  const session=await this.create({cwd,title:'Dudidam Command'});
  setTimeout(()=>{if(this.sessions.has(session.id))this.write(session.id,text+'\r');},100);
  return {ok:true,policy,session,command:redactSecrets(text)};
 }
 async runProjectTask(task,{confirmed=false}={}){
  const name=cleanText(task,50).toLowerCase();
  if(!['build','test','lint','typecheck','verify'].includes(name))throw new Error('Task project tidak didukung.');
  const root=await this._workspace();
  let pkg;
  try{pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));}catch{throw new Error('package.json tidak ditemukan pada workspace aktif.');}
  if(!pkg?.scripts?.[name])throw new Error('Script "'+name+'" tidak tersedia pada package.json. Dudidam tidak akan mengarang command.');
  return await this.runCommand('npm run '+name,{confirmed,cwd:root});
 }
 getRecentTerminalOutput(id){
  const session=this.sessions.get(cleanText(id,100));
  if(!session)throw new Error('Session terminal tidak ditemukan.');
  return {command:null,cwd:session.cwd,exitCode:session.exitCode,stdout:redactSecrets(session.recent),stderr:''};
 }
 async smokeTest(){
  const run=async(shell,marker)=>{
   const session=await this.create({shell,title:'CI '+shell});
   let output='';
   const onData=event=>{if(event.sessionId===session.id)output+=event.data;};
   this.on('data',onData);
   const command=session.shell==='cmd'?'echo '+marker+' & exit':"Write-Output '"+marker+"'; exit";
   this.write(session.id,command+'\r');
   const ok=await new Promise(resolve=>{
    const started=Date.now();
    const timer=setInterval(()=>{
     if(output.includes(marker)){clearInterval(timer);resolve(true);}
     else if(Date.now()-started>8000){clearInterval(timer);resolve(false);}
    },50);
   });
   this.off('data',onData);this.kill(session.id);
   return ok;
  };
  const detected=await this.detect(),shells={};
  for(const id of ['pwsh','powershell','cmd']){
   if(detected.shells?.[id]?.state!=='READY'){shells[id]='NOT FOUND';continue;}
   shells[id]=await run(id,'DUDIDDAM '+id.toUpperCase()+' OK')?'PASS':'FAIL';
  }
  const defaultShell=await this.resolveShell('default');
  const a=await this.create({shell:defaultShell.id,title:'CI multi A'}),b=await this.create({shell:'cmd',title:'CI multi B'});
  this.resize(a.id,100,24);this.resize(b.id,90,20);
  const multiple=this.list().some(x=>x.id===a.id)&&this.list().some(x=>x.id===b.id);
  this.kill(a.id);this.kill(b.id);
  return {shells,multiple,defaultShell:defaultShell.id};
 }
 shutdown(){
  for(const id of [...this.sessions.keys()])this.kill(id);
 }
}

export {commandPath};
