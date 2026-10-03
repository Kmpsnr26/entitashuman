import test from 'node:test';
import assert from 'node:assert/strict';
import {robotSamples,createRobotVoicePlayer} from '../public/robot-voice.js';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('robot modulation preserves duration, produces audio and fades both boundaries without clipping',()=>{
 const input=Float32Array.from({length:22050},(_,i)=>.5*Math.sin(2*Math.PI*200*i/22050));
 const original=input.slice(),output=robotSamples(input,22050);
 assert.equal(output.length,input.length);assert.deepEqual(input,original);
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
