import {spawn} from 'node:child_process';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateChat} from './bridge.mjs';
import {humanaleSystemPrompt} from './humanale-brain.mjs';

export async function findCopilot(){
 const candidates=[process.env.GITHUB_COPILOT_CLI_PATH,process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Microsoft','WinGet','Links','copilot.exe')].filter(Boolean);
 for(const candidate of candidates){try{await access(candidate);return candidate;}catch{}}
 return 'copilot';
}

function run(executable,args,{cwd,timeout=120000,children}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});
  children?.add(child);
  let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);children?.delete(child);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('GitHub Copilot belum merespons. Coba lagi.'));},timeout);
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1500000){child.kill();finish(new Error('Balasan Copilot terlalu besar.'));}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});
  child.on('error',()=>finish(new Error('GitHub Copilot CLI belum ditemukan. Pasang Copilot CLI lalu login.')));
  child.on('close',code=>finish(null,{code,stdout,stderr}));
 });
}

export class CopilotBridge{
 constructor({runImpl=run,findExecutable=findCopilot}={}){this.pending=false;this.verified=false;this.authenticated=false;this.children=new Set();this.run=runImpl;this.findExecutable=findExecutable;}
 async status(){
  const executable=await this.findExecutable();
  try{const result=await this.run(executable,['--version'],{timeout:12000,children:this.children});const installed=result.code===0;return {configured:installed,installed,mode:'copilot-cli',verified:this.verified,authenticated:this.authenticated,model:'GitHub Copilot CLI',busy:this.pending,statusError:installed?'':'STATUS_FAILED'};}
  catch{return {configured:false,installed:false,mode:'copilot-cli',verified:false,authenticated:false,statusError:'STATUS_FAILED'};}
 }
 async login(){
  if(this.pending)return {error:'Tunggu permintaan Copilot sebelumnya selesai.'};
  this.verified=false;
  this.authenticated=false;
  this.pending=true;
  try{const result=await this.run(await this.findExecutable(),['login','--web-flow'],{timeout:240000,children:this.children});if(result.code===0){this.authenticated=true;return {ok:true};}return {error:'Login GitHub Copilot belum selesai.'};}
  finally{this.pending=false;}
 }
 async ask(value){
  const data=validateChat(value);
  if(data.image)throw new Error('Foto belum didukung pada koneksi GitHub Copilot ini.');
  if(this.pending)throw new Error('Tunggu balasan GitHub Copilot sebelumnya selesai.');
  this.pending=true;let folder;
  try{
   folder=await mkdtemp(join(tmpdir(),'dudidam-copilot-'));
   const prompt=humanaleSystemPrompt(data.message,'Provider percakapan saat ini adalah GitHub Copilot. Ini percakapan, bukan tugas mengedit kode. Jangan memakai alat, membuka file, menjalankan perintah, atau mengklaim telah mengubah proyek.',data.memoryContext)+'\nRiwayat dan pesan pengguna dalam JSON: '+JSON.stringify({history:data.history,message:data.message});
   const args=['-p',prompt,'-s','--no-color','--no-ask-user','--no-auto-update','--no-custom-instructions','--disable-builtin-mcps','--no-remote-export','--output-format=text','--available-tools=view'];
   const result=await this.run(await this.findExecutable(),args,{cwd:folder,children:this.children});
   if(result.code!==0||!result.stdout.trim()){
    const detail=(result.stderr+'\n'+result.stdout).trim();
    if(/login|auth|credential|unauthorized|401/i.test(detail))throw new Error('GitHub Copilot perlu login. Buka kontrol avatar → Login Copilot.');
    if(/subscription|entitlement|license|policy|403/i.test(detail))throw new Error('Akun GitHub ini belum memiliki akses Copilot CLI atau dibatasi kebijakan organisasi.');
    throw new Error('GitHub Copilot belum memberikan balasan. '+detail.slice(0,250));
   }
   this.verified=true;
   this.authenticated=true;
   return {text:result.stdout.trim()};
  }catch(error){this.verified=false;if(/login|auth|credential|unauthorized|401/i.test(String(error?.message||'')))this.authenticated=false;throw error;}
  finally{this.pending=false;if(folder)await rm(folder,{recursive:true,force:true});}
 }
 stop(){for(const child of this.children){try{child.kill();}catch{}}this.children.clear();}
}
