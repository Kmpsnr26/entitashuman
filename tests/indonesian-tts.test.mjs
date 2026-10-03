import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {IndonesianTts,inspectSpeechWav,runIndonesianVoiceProcess} from '../desktop/indonesian-tts.mjs';

function wav({silent=false}={}){
 const result=Buffer.alloc(364);result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(1,22);result.writeUInt32LE(16000,24);result.writeUInt32LE(32000,28);result.writeUInt16LE(2,32);result.writeUInt16LE(16,34);result.write('data',36);result.writeUInt32LE(320,40);
 if(!silent)for(let offset=44;offset<result.length;offset+=2)result.writeInt16LE(offset%4?1200:-1200,offset);
 return result;
}

test('WAV acceptance rejects silent, truncated, empty and non-PCM output',()=>{
 assert.equal(inspectSpeechWav(wav()).durationSeconds,.01);
 for(const audio of [Buffer.alloc(0),wav({silent:true}),wav().subarray(0,360)])assert.throws(()=>inspectSpeechWav(audio));
 const float=wav();float.writeUInt16LE(3,20);assert.throws(()=>inspectSpeechWav(float),/PCM/);
});

test('Piper success remains preferred and does not invoke Windows helper',async()=>{
 const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args,timeout,input)=>{calls.push({executable,args,timeout,input});await writeFile(args[2],wav());return {code:0};}});
 const result=await tts.synthesize({text:'Halo Indonesia',style:'adult-robot'});
 assert.equal(result.engine,'piper');assert.equal(result.voiceGender,'unknown');assert.equal(result.preferredVoiceMatched,true);assert.equal(calls.length,1);assert.equal(calls[0].input,'Halo Indonesia');assert.equal(calls[0].args[3],'adult-robot');
});

test('explicit male preference starts confirmed Andika before Piper and returns clean PCM',async()=>{
 const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>{throw new Error('Piper should not run');},runProcess:async(executable,args,timeout,input)=>{
  calls.push({executable,args,input});assert.equal(args[args.indexOf('-VoiceCharacter')+1],'male');await writeFile(args[args.indexOf('-OutputPath')+1],wav());return {code:0,stdout:'{"voiceGender":"male"}'};
 }});
 const result=await tts.synthesize({text:'Saya HumanALE',style:'adult-robot',voiceCharacter:'male'});
 assert.equal(calls.length,1);assert.equal(result.engine,'windows-andika');assert.equal(result.voiceGender,'male');assert.equal(result.preferredVoiceMatched,true);assert.equal(result.fallbackReason,null);assert.equal(result.pcm.peak,1200);
});

test('failed or unverified male Andika falls back to Piper without false gender or a second Andika attempt',async()=>{
 for(const metadata of ['{"voiceGender":"female"}','{}','invalid-json']){
  const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args)=>{
   calls.push(executable);if(executable==='python'){assert.equal(args[3],'natural');await writeFile(args[2],wav());return {code:0};}
   await writeFile(args[args.indexOf('-OutputPath')+1],wav());return {code:0,stdout:metadata};
  }});
  const result=await tts.synthesize({text:'Halo',voiceCharacter:'male',style:'adult-robot'});
  assert.equal(calls.length,2);assert.equal(calls[1],'python');assert.equal(result.engine,'piper');assert.equal(result.voiceGender,'unknown');assert.equal(result.preferredVoiceMatched,false);assert.equal(result.fallbackReason,'windows-male-unavailable');
 }
});

test('male-first failure and failed Piper never retry Windows or leak diagnostic detail',async()=>{
 const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async executable=>{calls.push(executable);return {code:1,stderr:'PRIVATE INTERNAL'};}});
 await assert.rejects(tts.synthesize({text:'Halo',voiceCharacter:'male'}),error=>!error.message.includes('PRIVATE')&&error.message.includes('Windows Indonesia'));
 assert.equal(calls.length,2);assert.equal(calls[1],'python');assert.equal(tts.pending,false);
});

test('male preference on non-Windows uses Piper with honest unknown-gender diagnostic',async()=>{
 const tts=new IndonesianTts({platform:'linux',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args)=>{assert.equal(executable,'python');assert.equal(args[3],'natural');await writeFile(args[2],wav());return {code:0};}});
 const result=await tts.synthesize({text:'Halo',voiceCharacter:'male'});assert.equal(result.voiceGender,'unknown');assert.equal(result.preferredVoiceMatched,false);assert.equal(result.fallbackReason,'male-engine-unavailable');
});

test('unsupported voice characters reject before any synthesis process starts',async()=>{
 let starts=0;const tts=new IndonesianTts({runProcess:async()=>{starts++;}});
 for(const voiceCharacter of ['female','MALE','../male',null,{},0])await assert.rejects(tts.synthesize({text:'Halo',voiceCharacter}),/auto atau male/);
 assert.equal(starts,0);assert.equal(tts.pending,false);
});

test('cancel during male-first Windows request stops without attempting Piper',async()=>{
 let release;const calls=[];const tts=new IndonesianTts({platform:'win32',runProcess:async(executable,args)=>{
  calls.push(executable);await new Promise(resolve=>{release=resolve;});await writeFile(args[args.indexOf('-OutputPath')+1],wav());return {code:0,stdout:'{"voiceGender":"male"}'};
 }});
 const speech=tts.synthesize({text:'Halo',voiceCharacter:'male'});const rejection=assert.rejects(speech,/dibatalkan/);
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));const stopping=tts.stop();release();await Promise.all([stopping,rejection]);assert.equal(calls.length,1);assert.equal(tts.pending,false);
});

test('failed or silent Piper falls back to Andika with bounded text on stdin and stale WAV removed',async()=>{
 for(const failWithSilence of [false,true]){
  const calls=[];const text='Halo Indonesia; $(bukan perintah) ` tidak dijalankan';
  const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args,timeout,input)=>{
   calls.push({executable,args,timeout,input});
   if(executable==='python'){await writeFile(args[2],wav({silent:true}));return {code:failWithSilence?0:1,stderr:'private backend detail'};}
   const path=args[args.indexOf('-OutputPath')+1];await assert.rejects(readFile(path),{code:'ENOENT'});await writeFile(path,wav());return {code:0};
  }});
  const result=await tts.synthesize({text,style:'baby-robot'});assert.equal(result.engine,'windows-andika');assert.equal(result.fallbackReason,'piper-unavailable');assert.equal(calls.length,2);assert.equal(calls[1].input,text);assert.ok(!calls[1].args.includes(text));assert.ok(calls[1].args.includes('-NonInteractive'));assert.ok(calls[1].args.includes('-File'));assert.equal(result.pcm.peak,1200);
 }
});

test('failed fallback reports safe error and releases synthesis lock',async()=>{
 const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async()=>({code:1,stderr:'PRIVATE BACKEND VALUE'})});
 await assert.rejects(tts.synthesize({text:'Halo'}),error=>error.message.includes('Windows Indonesia')&&!error.message.includes('PRIVATE'));
 assert.equal(tts.pending,false);
});

test('cancellation during Piper does not start fallback or accept late output',async()=>{
 let release;const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args,timeout,input,children,signal)=>{
  calls.push(executable);await new Promise(resolve=>{release=resolve;});await writeFile(args[2],wav());assert.equal(signal.aborted,true);return {code:0};
 }});
 const pending=tts.synthesize({text:'Halo'});while(!release)await new Promise(resolve=>setTimeout(resolve,1));
 tts.stop();release();await assert.rejects(pending,/dibatalkan/);assert.deepEqual(calls,['python']);assert.equal(tts.pending,false);
});

test('stop waits for cancelled synthesis and cleanup before a new request can begin',async()=>{
 let release,firstPath;const calls=[];let stopped=false;
 const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args)=>{
  calls.push(executable);if(calls.length===1){firstPath=args[2];await new Promise(resolve=>{release=resolve;});}
  await writeFile(args[2],wav());return {code:0};
 }});
 const first=tts.synthesize({text:'Pertama'});const rejected=assert.rejects(first,/dibatalkan/);
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));
 const stopping=tts.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
 await assert.rejects(tts.synthesize({text:'Terlalu awal'}),/masih dibuat/);release();await Promise.all([stopping,rejected]);
 assert.equal(tts.pending,false);await assert.rejects(readFile(firstPath),{code:'ENOENT'});
 const next=await tts.synthesize({text:'Berikutnya'});assert.equal(next.engine,'piper');assert.deepEqual(calls,['python','python']);assert.equal(tts.pending,false);
});

test('cancel during Windows fallback never returns late audio or leaves pending locked',async()=>{
 let release;const calls=[];const tts=new IndonesianTts({platform:'win32',resolvePython:async()=>'python',resolveModel:async()=>'model',runProcess:async(executable,args)=>{
  calls.push(executable);if(executable==='python')return {code:1};
  await new Promise(resolve=>{release=resolve;});await writeFile(args[args.indexOf('-OutputPath')+1],wav());return {code:0};
 }});
 const speech=tts.synthesize({text:'Halo'});const rejection=assert.rejects(speech,/dibatalkan/);
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));const stopping=tts.stop();release();await Promise.all([stopping,rejection]);assert.equal(calls.length,2);assert.equal(tts.pending,false);
});

test('status can report usable Andika when Piper unavailable without claiming playback',async()=>{
 const tts=new IndonesianTts({platform:'win32',resolveModel:async()=>'missing-model',runProcess:async(executable,args)=>{assert.equal(args[args.indexOf('-Mode')+1],'status');return {code:0,stdout:'{"configured":true,"voiceGender":"male"}'};}});
 const status=await tts.status();assert.equal(status.configured,true);assert.equal(status.engine,'windows-andika');assert.equal(status.engines.piper.configured,false);assert.equal(status.engines.windows.voice,'Microsoft Andika');assert.equal(status.engines.windows.voiceGender,'male');assert.equal(status.playbackStarted,undefined);
});

test('process contract passes raw UTF-8 stdin and tracks child through close',async()=>{
 const children=new Set(),text='Halo bahasa Indonesia; $(aman) `';
 const result=await runIndonesianVoiceProcess(process.execPath,['-e',"let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s));"],3000,text,children);
 assert.equal(result.stdout,text);assert.equal(result.code,0);assert.equal(children.size,0);
});

test('process cancellation terminates and settles without leaking tracked child',async()=>{
 const controller=new AbortController(),children=new Set();
 const pending=runIndonesianVoiceProcess(process.execPath,['-e','setInterval(()=>{},1000)'],3000,'',children,controller.signal);
 assert.equal(children.size,1);controller.abort();await assert.rejects(pending,/dibatalkan/);assert.equal(children.size,0);
});

test('process timeout and spawn errors fail without exposing stderr',async()=>{
 const children=new Set();await assert.rejects(runIndonesianVoiceProcess(process.execPath,['-e','setInterval(()=>{},1000)'],20,'',children),/belum merespons/);assert.equal(children.size,0);
 await assert.rejects(runIndonesianVoiceProcess('humanale-nonexistent-python-voice',[],100,'',children),/tidak ditemukan/);assert.equal(children.size,0);
});

test('input bounds reject before launching a speech process',async()=>{
 let calls=0;const tts=new IndonesianTts({runProcess:async()=>{calls++;}});
 await assert.rejects(tts.synthesize({text:''}),/1–2000/);await assert.rejects(tts.synthesize({text:'a'.repeat(2001)}),/1–2000/);assert.equal(calls,0);
});
