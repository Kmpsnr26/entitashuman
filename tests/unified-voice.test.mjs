import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createNaraStudioServer} from '../nara-core/studio/server.mjs';
import {createStudioVoice,voiceProfilePatch} from '../nara-core/studio/public/voice-identity.js';
import {sanitizeVisualSettings} from '../nara-core/studio/public/custom-settings.js';
import {HUMANALE_VOICE} from '../public/robot-voice.js';

test('legacy Studio voice preferences migrate to the one adult character',()=>{
 for(const profile of ['deep','calm','droid','natural','baby-robot','unknown']){
  const result=sanitizeVisualSettings({voiceProfile:profile,voiceRate:1.15,voicePitch:1.2,voiceURI:'other',droidCharacter:true});
  for(const [key,value] of Object.entries(voiceProfilePatch()))assert.equal(result[key],value);
 }
});

test('all app provider and avatar calls use adult PCM irrespective of supplied legacy style',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function speak(text'),source.indexOf('\nfunction ',source.indexOf('function speak(text')+1));
 for(const style of ['natural','baby-robot','adult-robot']){
  const calls=[];const scope={voiceStyle:HUMANALE_VOICE.style,voice:true,robotVoicePlayer:{unlock:()=>Promise.resolve()},stopSpeech(){},stopListening(){},suspendWakeListening(){},panelOnly:false,localTtsRejected:false,desktop:{synthesize(){}},androidVoice:null,speakLocal:(text,actual)=>calls.push({text,actual})};
  runInNewContext(fn+';speak("Halo",'+JSON.stringify({style,source:'assistant'})+');',scope);
  assert.equal(calls[0].actual,'adult-robot');
 }
});

test('Studio PCM endpoints require a session and same origin, and normalize source once',async t=>{
 const calls=[],stops=[];
 const studio=createNaraStudioServer({host:'127.0.0.1',port:0,creatorAuth:{username:'creator',password:'FixtureSecret123!',required:true},voiceBackend:{synthesize:async(actor,value)=>{calls.push({actor,value});return{audio:Buffer.alloc(100).toString('base64'),mime:'audio/wav',voiceGender:'male'};},stop:async actor=>stops.push(actor)}});
 const address=await studio.start();t.after(()=>studio.stop());const base='http://127.0.0.1:'+address.port;
 const post=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(data)});
 assert.equal((await post('/api/voice/synthesize',{text:'Halo'})).status,401);
 const login=await post('/api/creator/login',{username:'creator',password:'FixtureSecret123!'});const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('/api/voice/synthesize',{text:'Halo'},{cookie,origin:'http://evil.invalid'})).status,403);
 assert.equal((await post('/api/voice/synthesize',{text:'x'.repeat(2001)},{cookie})).status,400);
 assert.equal((await post('/api/voice/synthesize',{text:'Halo',style:'baby-robot',voiceCharacter:'auto'},{cookie})).status,200);
 assert.deepEqual(calls[0].value,{text:'Halo',style:'natural',voiceCharacter:'male'});assert.match(calls[0].actor,/^studio:[a-f0-9]{64}$/);
 const shared=await fetch(base+'/public/robot-voice.js');assert.equal(shared.status,200);assert.match(await shared.text(),/HUMANALE_VOICE/);
 await post('/api/voice/stop',{},{cookie});assert.equal(stops[0],calls[0].actor);
 await post('/api/creator/logout',{},{cookie});assert.equal((await post('/api/voice/synthesize',{text:'Halo'},{cookie})).status,401);
});

test('standalone optional authentication never opens PCM endpoints to anonymous clients',async t=>{
 let called=false;const studio=createNaraStudioServer({host:'127.0.0.1',port:0,creatorAuth:{required:false},voiceBackend:{synthesize:()=>{called=true;},stop(){}}});
 const address=await studio.start();t.after(()=>studio.stop());const base='http://127.0.0.1:'+address.port;
 const response=await fetch(base+'/api/voice/synthesize',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({text:'Halo'})});assert.equal(response.status,401);assert.equal(called,false);
});

test('Studio shares adult PCM player, preserves volume, and cancels stale synthesis',async()=>{
 let release,played=0,lastOptions;const player={stop(){},unlock:async()=>{},play:async(_bytes,options)=>{played++;lastOptions=options;return true;}};
 const voice=createStudioVoice({player,fetchImpl:async path=>path.endsWith('/stop')?{ok:true}:new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({audio:'AAAA',voiceGender:'male'})});})});
 const pending=voice.speak('Halo',{volume:.4});await new Promise(resolve=>setImmediate(resolve));await voice.stop();release();assert.equal(await pending,false);assert.equal(played,0);
 const next=voice.speak('Lagi',{volume:.4});await new Promise(resolve=>setImmediate(resolve));release();assert.equal(await next,true);assert.equal(lastOptions.style,'adult-robot');assert.equal(lastOptions.volume,.4);await voice.stop();
});
