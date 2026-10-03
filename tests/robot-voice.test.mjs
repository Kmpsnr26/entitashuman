import test from 'node:test';
import assert from 'node:assert/strict';
import {robotSamples,createRobotVoicePlayer,voiceProfile} from '../public/robot-voice.js';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('adult bass processing adds an echo tail, produces audio and fades without clipping',()=>{
 const input=Float32Array.from({length:22050},(_,i)=>.5*Math.sin(2*Math.PI*200*i/22050));
 const original=input.slice(),output=robotSamples(input,22050);
 assert.equal(output.length,input.length+Math.round(22050*.27));assert.deepEqual(input,original);
 assert.equal(Math.abs(output[0]),0);assert.equal(Math.abs(output.at(-1)),0);
 assert.ok(output.some((x,i)=>i>300&&Math.abs(x-input[i])>.05));
 assert.ok(output.reduce((sum,x)=>sum+x*x,0)/output.length>.04);
 for(const x of output)assert.ok(Number.isFinite(x)&&Math.abs(x)<=.98);
});
test('natural voice has no modulation and malformed samples never reach speakers',()=>{
 const samples=new Float32Array(2000).fill(.4);const output=robotSamples(samples,16000,'natural');
 assert.equal(output[1000],samples[1000]);
 assert.ok(robotSamples(Float32Array.of(NaN,Infinity,-Infinity,3,-3),16000).every(Number.isFinite));
 assert.throws(()=>robotSamples(samples,0));
});

const rms=samples=>Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
const tone=(frequency,rate=16000,length=rate)=>Float32Array.from({length},(_,i)=>.15*Math.sin(2*Math.PI*frequency*i/rate));

test('adult silence and empty input remain silent; loud malformed input remains bounded',()=>{
 assert.equal(robotSamples(new Float32Array(),16000).length,0);
 assert.ok(robotSamples(new Float32Array(1600),16000).every(value=>value===0));
 const loud=Float32Array.from({length:16000},(_,i)=>i%11===0?NaN:i%13===0?Infinity:4*Math.sin(i*.2));
 const original=loud.slice(),output=robotSamples(loud,16000);
 assert.deepEqual(loud,original);
 assert.ok(output.every(value=>Number.isFinite(value)&&Math.abs(value)<=.981));
});

test('adult rejects DC while strengthening bass relative to midrange without removing presence',()=>{
 const dc=robotSamples(new Float32Array(16000).fill(.4),16000).slice(8000,15000);
 assert.ok(rms(dc)<.00001,'steady DC must not reach the output');
 // Inspect settled dry audio before the first echo; different frequencies must
 // exercise filter behavior rather than duplicate its coefficients.
 const response=frequency=>rms(robotSamples(tone(frequency),16000).slice(800,1760));
 const bass=(response(140)+response(180)+response(220))/3;
 const mid=(response(1000)+response(2000)+response(3000))/3;
 assert.ok(bass>mid*1.05,'bass should be stronger than the midrange');
 assert.ok(response(3000)>.06,'consonant presence must remain audible');
});

test('adult echo survives the source boundary, decays and filters high frequency repeats',()=>{
 const low=tone(500,16000,1600),original=low.slice();
 const output=robotSamples(low,16000),high=robotSamples(tone(6000,16000,1600),16000);
 assert.deepEqual(low,original);
 const early=rms(output.slice(2000,3500)),late=rms(output.slice(5000,5600));
 assert.ok(early>.005,'tail should contain a real echo');
 assert.ok(late<early*.6,'later repeat must decay');
 assert.ok(rms(high.slice(2000,3500))<early*.6,'echo should suppress harsh upper detail');
 assert.equal(Math.abs(output.at(-1)),0);
});

test('adult playback uses extended PCM and slow pitch profile; baby and natural keep duration',async()=>{
 const parameter=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}});
 let created,active;
 class Context{
  state='running';currentTime=0;destination={};resume(){return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({numberOfChannels:2,sampleRate:16000,getChannelData:()=>tone(200,16000,1600)});}
  createBuffer(channels,length,rate){const samples=[];created={length,channels,sampleRate:rate,duration:length/rate,copyToChannel(data,index){samples[index]=data;},getChannelData:index=>samples[index]};return created;}
  node(){return {gain:parameter(),frequency:parameter(),playbackRate:parameter(),connect(){},disconnect(){},start(){},stop(){this.onended?.();}};}
  createBufferSource(){active=this.node();return active;}createGain(){return this.node();}createOscillator(){return this.node();}
 }
 const player=createRobotVoicePlayer({AudioContext:Context});
 try{
  for(const [style,rate,extra] of [['adult-robot',.84,4320],['baby-robot',1.1,0],['natural',1,0]]){
   await player.play(new Uint8Array(44),{style});
   assert.equal(voiceProfile(style).rate,rate);assert.equal(active.playbackRate.value,rate);
   assert.equal(created.length,1600+extra);assert.equal(created.channels,2);
   assert.equal(created.getChannelData(0).length,created.length);assert.equal(created.getChannelData(1).length,created.length);
   player.stop();
  }
 }finally{player.stop();}
});
test('cancel during asynchronous decode never starts stale speech',async()=>{
 let finishDecode,starts=0;
 class Context{
  state='running';currentTime=0;destination={};resume(){return Promise.resolve();}
  decodeAudioData(){return new Promise(resolve=>{finishDecode=resolve;});}
  createBuffer(){throw new Error('Cancelled decode must not create playable buffers');}
  createBufferSource(){starts++;}
 }
 const player=createRobotVoicePlayer({AudioContext:Context});
 const playing=player.play(new Uint8Array(44));await Promise.resolve();
 player.stop();finishDecode({});assert.equal(await playing,false);assert.equal(starts,0);
});
test('suspended audio fails visibly before decode or playback',async()=>{
 class Context{state='suspended';resume(){return Promise.resolve();}}
 const player=createRobotVoicePlayer({AudioContext:Context});
 await assert.rejects(player.play(new Uint8Array(44)),/Ketuk Uji suara/);
});
test('interrupt disconnects speech and transition nodes without completion or stale callbacks',async()=>{
 const nodes=[];let completed=0;
 const parameter=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}});
 class Context{
  state='running';currentTime=0;destination={};resume(){return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({numberOfChannels:1,length:2000,sampleRate:16000,getChannelData:()=>new Float32Array(2000).fill(.2)});}
  createBuffer(){return {duration:.125,sampleRate:16000,copyToChannel(){},getChannelData:()=>new Float32Array(2000).fill(.2)};}
  node(type){const node={type,connections:0,disconnects:0,gain:parameter(),frequency:parameter(),playbackRate:parameter(),connect(){this.connections++;},disconnect(){this.disconnects++;},start(){},stop(){this.onended?.();}};nodes.push(node);return node;}
  createBufferSource(){return this.node('speech');}createGain(){return this.node('gain');}createOscillator(){return this.node('transition');}
 }
 const player=createRobotVoicePlayer({AudioContext:Context});await player.play(new Uint8Array(44),{onend:()=>completed++});player.stop();
 assert.equal(completed,0);assert.ok(nodes.every(node=>node.disconnects>0));
});
test('cancelled browser voice start and boundary events cannot restore speaking state',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function speakNativeIndonesian('),end=source.indexOf('\nfunction speak(text',start);
 const voice={voiceURI:'id-local',lang:'id-ID'},events=[];let utterance;
 const scope={window:{speechSynthesis:{getVoices:()=>[voice]}},speechSynthesis:{speak:u=>{utterance=u;}},SpeechSynthesisUtterance:function(text){this.text=text;},selectedVoiceURI:'',getIndonesianVoices:()=>[voice],speechGeneration:1,voiceStyle:'adult-robot',ttsActive:false,ttsEnergy:0,speechTimer:0,syncFaceAudio:()=>events.push('sync'),naraDispatch:()=>events.push('event'),avatar:{trigger:()=>{}},state:()=>{},performance:{now:()=>1000},lastNaraSpeechSent:0,setTimeout:()=>1,clearTimeout(){},stopSpeech(){},resumeWakeSoon(){},finishSpeechSource(){},setMicStatus(){},activeSpeechSource:'assistant'};
 runInNewContext(source.slice(start,end)+';speakNativeIndonesian("Halo");',scope);
 scope.speechGeneration++;utterance.onstart();utterance.onboundary({charIndex:1});
 assert.equal(scope.ttsActive,false);assert.equal(scope.ttsEnergy,0);assert.deepEqual(events,[]);
});
