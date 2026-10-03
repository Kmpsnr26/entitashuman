import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceRequestCoordinator} from '../desktop/voice-request-coordinator.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function service(){
 const requests=[];let current=null,stopCount=0,cleanup=null;
 return {
  requests,
  get stopCount(){return stopCount;},
  deferCleanup(){cleanup=deferred();return cleanup;},
  synthesize(value){const request={...deferred(),value};requests.push(request);current=request;return request.promise.finally(()=>{if(current===request)current=null;});},
  async stop(){stopCount++;const request=current;if(request){request.reject(new Error('dibatalkan'));await request.promise.catch(()=>{});}if(cleanup){const waiting=cleanup;cleanup=null;await waiting.promise;}}
 };
}

test('root renderer stop cannot cancel pending detached-panel synthesis',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 const panel=voice.synthesize('panel',{text:'Halo'});await tick();
 assert.deepEqual(await voice.stop('root'),{stopped:false});assert.equal(tts.stopCount,0);
 tts.requests[0].resolve({audio:'panel'});assert.deepEqual(await panel,{audio:'panel'});
});

test('same actor stop cancels without waiting behind full synthesis and waits for cleanup',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 const request=voice.synthesize('panel',{text:'Halo'});const rejected=assert.rejects(request,/dibatalkan/);await tick();
 const cleanup=tts.deferCleanup();let settled=false;
 const stop=voice.stop('panel').then(result=>{settled=true;return result;});await tick();
 assert.equal(tts.stopCount,1);assert.equal(settled,false);cleanup.resolve();
 assert.deepEqual(await stop,{stopped:true});await rejected;
});

test('new actor request settles previous cancellation before starting new synthesis',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 const old=voice.synthesize('old',{text:'Pertama'});const rejected=assert.rejects(old,/dibatalkan/);await tick();
 const cleanup=tts.deferCleanup();const next=voice.synthesize('new',{text:'Berikutnya'});await tick();
 assert.equal(tts.requests.length,1);cleanup.resolve();await tick();assert.equal(tts.requests.length,2);
 assert.deepEqual(await voice.stop('old'),{stopped:false});assert.equal(tts.stopCount,1);
 tts.requests[1].resolve({audio:'new'});assert.deepEqual(await next,{audio:'new'});await rejected;
});

test('three overlapping requests skip superseded middle start and preserve newest owner',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 const first=voice.synthesize('A',{text:'A'});const firstRejected=assert.rejects(first,/dibatalkan/);await tick();
 const cleanup=tts.deferCleanup();const middle=voice.synthesize('B',{text:'B'});const middleRejected=assert.rejects(middle,error=>error.code==='TTS_REQUEST_SUPERSEDED');await tick();
 const last=voice.synthesize('C',{text:'C'});cleanup.resolve();await tick();
 assert.deepEqual(tts.requests.map(request=>request.value.text),['A','C']);
 assert.deepEqual(await voice.stop('A'),{stopped:false});assert.deepEqual(await voice.stop('B'),{stopped:false});
 tts.requests[1].resolve({audio:'C'});assert.deepEqual(await last,{audio:'C'});await Promise.all([firstRejected,middleRejected]);
});

test('synchronous overlap starts only newest request and errors do not poison mutation queue',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 const one=voice.synthesize('A',{text:'A'}),two=voice.synthesize('B',{text:'B'}),three=voice.synthesize('C',{text:'C'});
 const failures=[assert.rejects(one,{code:'TTS_REQUEST_SUPERSEDED'}),assert.rejects(two,{code:'TTS_REQUEST_SUPERSEDED'}),assert.rejects(three,/engine failed/)];
 await tick();assert.deepEqual(tts.requests.map(request=>request.value.text),['C']);tts.requests[0].reject(new Error('engine failed'));await Promise.all(failures);
 const next=voice.synthesize('D',{text:'D'});await tick();assert.deepEqual(await voice.stop('C'),{stopped:false});tts.requests[1].resolve('ready');assert.equal(await next,'ready');
});

test('synchronous service error clears only its own request and leaves coordinator usable',async()=>{
 let count=0;const voice=createVoiceRequestCoordinator({synthesize(){if(!count++)throw new Error('synchronous failure');return Promise.resolve('ok');},async stop(){}});
 await assert.rejects(voice.synthesize('panel',{}),/synchronous failure/);assert.deepEqual(await voice.stop('panel'),{stopped:false});assert.equal(await voice.synthesize('panel',{}),'ok');
});

test('early synthesis rejection is handled even when caller reads response later',async()=>{
 const voice=createVoiceRequestCoordinator({synthesize:()=>Promise.reject(new Error('early failure')),async stop(){}});
 const response=voice.synthesize('panel',{});await tick();await tick();
 await assert.rejects(response,/early failure/);assert.deepEqual(await voice.stop('panel'),{stopped:false});
});

test('stop failure prevents replacement start but later completion does not poison queue',async()=>{
 const request=deferred();let starts=0,failStop=true;
 const voice=createVoiceRequestCoordinator({synthesize(){starts++;return starts===1?request.promise:Promise.resolve('next');},async stop(){if(failStop)throw new Error('stop failed');}});
 const first=voice.synthesize('A',{});await tick();await assert.rejects(voice.synthesize('B',{}),/stop failed/);assert.equal(starts,1);
 request.resolve('old');assert.equal(await first,'old');failStop=false;assert.equal(await voice.synthesize('C',{}),'next');
});

test('numeric actors match their string IDs and malformed identities launch nothing',async()=>{
 const tts=service(),voice=createVoiceRequestCoordinator(tts);
 for(const actor of ['',{},null,'a'.repeat(129)])await assert.rejects(voice.synthesize(actor,{}),/Identitas/);
 assert.equal(tts.requests.length,0);const request=voice.synthesize(17,{});const rejected=assert.rejects(request,/dibatalkan/);await tick();assert.deepEqual(await voice.stop('17'),{stopped:true});await rejected;
});
