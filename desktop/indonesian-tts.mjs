import {spawn} from 'node:child_process';
import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
const modelName='id_ID-news_tts-medium.onnx';
const appDataRoot=process.env.LOCALAPPDATA||homedir();
const primaryModelFolder=join(appDataRoot,'HumanALE god egine','voice-models','piper','id','id_ID','news_tts','medium');
const legacyModelFolder=join(appDataRoot,'HumanALE god egine','voice-models','piper','id','id_ID','news_tts','medium');

async function modelFolder(){
 for(const folder of [primaryModelFolder,legacyModelFolder]){
  try{await access(join(folder,modelName));await access(join(folder,modelName+'.json'));return folder;}catch{}
 }
 return primaryModelFolder;
}

async function pythonPath(){
 const candidates=[process.env.HUMANALE_PYTHON_PATH,process.env.DUDIDAM_PYTHON_PATH,join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe')].filter(Boolean);
 for(const candidate of candidates){try{await access(candidate);return candidate;}catch{}}
 return process.platform==='win32'?'python.exe':'python3';
}
function run(executable,args,timeout=90000,input='',children,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('Pembuatan suara dibatalkan.'));return;}
  const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});children?.add(child);let stderr='',stdout='',done=false,stopError;
  const finish=(error,code)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);children?.delete(child);error?reject(error):resolve({code,stderr,stdout});};
  const cancel=()=>{stopError=new Error('Pembuatan suara dibatalkan.');child.kill();};
  const timer=setTimeout(()=>{stopError=new Error('Layanan suara Indonesia belum merespons.');child.kill();},timeout);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1000);});
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-32768);});
  child.on('error',()=>finish(new Error('Runtime suara Indonesia tidak ditemukan.')));
  child.on('close',code=>finish(stopError,code));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export const runIndonesianVoiceProcess=run;
const windowsHelper=join(import.meta.dirname,'speak_windows.ps1');
const powershellPath=()=>join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const windowsArgs=(mode,output)=>['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',windowsHelper,'-Mode',mode,...(output?['-OutputPath',output]:[])];

export function inspectSpeechWav(audio){
 if(!Buffer.isBuffer(audio)||audio.length<44||audio.length>15000000||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE'||audio.readUInt32LE(4)+8!==audio.length)throw new Error('Hasil suara WAV tidak valid.');
 let format,data;
 for(let offset=12;offset+8<=audio.length;){
  const size=audio.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end>audio.length)throw new Error('Hasil suara WAV terpotong.');
  const name=audio.toString('ascii',offset,offset+4);
  if(name==='fmt '&&size>=16)format={encoding:audio.readUInt16LE(start),channels:audio.readUInt16LE(start+2),sampleRate:audio.readUInt32LE(start+4),byteRate:audio.readUInt32LE(start+8),blockAlign:audio.readUInt16LE(start+12),bits:audio.readUInt16LE(start+14)};
  if(name==='data')data=audio.subarray(start,end);
  offset=end+(size%2);
 }
 if(!format||!data?.length||format.encoding!==1||![1,2].includes(format.channels)||format.bits!==16||format.sampleRate<8000||format.sampleRate>96000||format.blockAlign!==format.channels*2||format.byteRate!==format.sampleRate*format.blockAlign||data.length%format.blockAlign!==0)throw new Error('Hasil suara PCM WAV tidak valid.');
 let peak=0;for(let index=0;index<data.length;index+=2)peak=Math.max(peak,Math.abs(data.readInt16LE(index)));
 if(peak===0)throw new Error('Hasil suara hanya berisi keheningan.');
 return {channels:format.channels,sampleRate:format.sampleRate,bits:format.bits,durationSeconds:data.length/format.byteRate,peak};
}
export class IndonesianTts{
 constructor({platform=process.platform,runProcess=run,resolvePython=pythonPath,resolveModel=modelFolder}={}){this.pending=false;this.children=new Set();this.platform=platform;this.runProcess=runProcess;this.resolvePython=resolvePython;this.resolveModel=resolveModel;this.generation=0;this.activeController=null;this.activeCompletion=null;}
 async status(){
  const generation=this.generation,controller=new AbortController();
  const engines={piper:{configured:false},windows:{configured:false,voice:null}};
  try{const folder=await this.resolveModel();await access(join(folder,modelName));await access(join(folder,modelName+'.json'));const result=await this.runProcess(await this.resolvePython(),['-c','import piper'],10000,'',this.children,controller.signal);engines.piper.configured=result.code===0;}catch{}
  if(generation!==this.generation)return {configured:false,mode:'local-indonesian',reason:'cancelled',engines};
  if(this.platform==='win32')try{const result=await this.runProcess(powershellPath(),windowsArgs('status'),10000,'',this.children,controller.signal);const status=JSON.parse(result.stdout||'{}');engines.windows={configured:result.code===0&&status.configured===true,voice:status.configured===true?'Microsoft Andika':null};}catch{}
  if(generation!==this.generation)return {configured:false,mode:'local-indonesian',reason:'cancelled',engines};
  return {configured:engines.piper.configured||engines.windows.configured,mode:'local-indonesian',engine:engines.piper.configured?'piper':engines.windows.configured?'windows-andika':null,engines};
 }
 async synthesize(value){
  const text=String(value?.text||'').trim();
  if(!text||text.length>2000)throw new Error('Teks suara harus berisi 1–2000 karakter.');
  const style=['natural','baby-robot','adult-robot'].includes(value?.style)?value.style:'baby-robot';
  if(this.pending)throw new Error('Suara sebelumnya masih dibuat.');
  this.pending=true;let folder,settled;const generation=this.generation,controller=new AbortController();this.activeController=controller;
  const completion=new Promise(resolve=>{settled=resolve;});this.activeCompletion=completion;
  const checkCancelled=()=>{if(controller.signal.aborted||generation!==this.generation)throw new Error('Pembuatan suara dibatalkan.');};
  try{
   folder=await mkdtemp(join(tmpdir(),'humanale-suara-'));
   const output=join(folder,'speech.wav');
   let piperFailed=false;
   try{
    const voiceFolder=await this.resolveModel();checkCancelled();
    const result=await this.runProcess(await this.resolvePython(),[join(import.meta.dirname,'speak_id.py'),join(voiceFolder,modelName),output,style],120000,text,this.children,controller.signal);
    checkCancelled();if(result.code!==0)throw new Error('Piper gagal membuat suara.');
    const audio=await readFile(output);const pcm=inspectSpeechWav(audio);checkCancelled();
    return {audio:audio.toString('base64'),mime:'audio/wav',engine:'piper',pcm};
   }catch{checkCancelled();piperFailed=true;}
   if(this.platform!=='win32')throw new Error('Suara Indonesia lokal gagal. Periksa runtime dan model Piper.');
   await rm(output,{force:true});checkCancelled();
   const result=await this.runProcess(powershellPath(),windowsArgs('synthesize',output),30000,text,this.children,controller.signal);
   checkCancelled();if(result.code!==0)throw new Error('Piper dan suara Windows Indonesia belum dapat membuat audio.');
   const audio=await readFile(output);const pcm=inspectSpeechWav(audio);checkCancelled();
   return {audio:audio.toString('base64'),mime:'audio/wav',engine:'windows-andika',fallbackReason:piperFailed?'piper-unavailable':null,pcm};
  }finally{
   try{if(folder)await rm(folder,{recursive:true,force:true});}
   finally{if(this.activeController===controller){this.activeController=null;this.activeCompletion=null;this.pending=false;}settled();}
  }
 }
 async stop(){const completion=this.activeCompletion;this.generation++;this.activeController?.abort();for(const child of this.children){try{child.kill();}catch{}}if(completion)await completion;}
}
