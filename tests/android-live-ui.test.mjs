import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLiveUrl,setupAndroidLive} from '../public/android-live.js';

test('Live endpoints allow HTTPS or exact loopback HTTP and never retain login material',()=>{
  assert.equal(normalizeLiveUrl('http://127.0.0.1:4178'),'http://127.0.0.1:4178/');
  assert.equal(normalizeLiveUrl('http://localhost:4200/'),'http://localhost:4200/');
  assert.equal(normalizeLiveUrl('http://[::1]:4178/'),'http://[::1]:4178/');
  assert.equal(normalizeLiveUrl(' https://nara.example.test/ '),'https://nara.example.test/');
  for(const url of ['http://192.168.1.5:4178','http://127.0.0.1.evil.test','http://127.1:4178','http://2130706433:4178','http://127.0.0.1:0','https://nara.example.test:0','file:///etc/passwd','javascript:alert(1)','https://owner:secret@nara.example.test','https://nara.example.test/?code=abc','https://nara.example.test/#secret','https://nara.example.test:70000'])assert.throws(()=>normalizeLiveUrl(url));
});

test('Android launch persists only endpoint after a confirmed opened result, not a live claim',async()=>{
  const nodes=new Map();
  for(const id of ['androidLiveOpen','androidLiveDialog','androidLiveForm','androidLiveUrl','androidLiveAuth','androidLiveStatus','androidLiveConnect','androidLiveClose'])nodes.set('#'+id,{value:'',listeners:{},addEventListener(e,f){this.listeners[e]=f;},showModal(){},close(){}});
  const doc={querySelector:id=>nodes.get(id)},saved=[];
  let opened=false;
  const cap={getPlatform:()=> 'android',Plugins:{HumanALERuntime:{open:async()=>({opened})}}};
  assert.equal(setupAndroidLive({document:doc,capacitor:cap,storage:{getItem:()=>null,setItem:(k,v)=>saved.push(JSON.parse(v))}}),true);
  const get=id=>nodes.get('#'+id);
  get('androidLiveUrl').value='http://127.0.0.1:4178';
  get('androidLiveOpen').listeners.click();
  await get('androidLiveForm').listeners.submit({preventDefault(){}});
  assert.equal(saved.length,0);
  assert.match(get('androidLiveStatus').textContent,/belum/);
  opened=true;
  await get('androidLiveForm').listeners.submit({preventDefault(){}});
  assert.deepEqual(saved,[{url:'http://127.0.0.1:4178/',authOrigin:''}]);
  assert.match(get('androidLiveStatus').textContent,/diperiksa di server/);
  assert.equal(get('androidLiveConnect').disabled,false);
});

test('Desktop and ordinary web never activate native Android runtime',()=>{
  assert.equal(setupAndroidLive({capacitor:{getPlatform:()=> 'web'},document:{},storage:{}}),false);
});
