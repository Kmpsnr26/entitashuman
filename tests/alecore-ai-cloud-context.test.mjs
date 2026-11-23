import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AleCloudContextClient,
  normalizeOrigin
} from '../desktop/alecore-ai-cloud-context.mjs';

import {
  validateMemoryContext
} from '../desktop/memory-context.mjs';

const origin='https://ale.example.test';
const csrf='test-csrf-token-value-1234567890';
const entryId='11111111-1111-4111-8111-111111111111';

function packet(approved=true){
 const text='[Project]\nMemory cloud aman.';
 return {
  version:1,
  target:'reasoner',
  mode:'ask',
  approved,
  count:1,
  chars:text.length,
  entryIds:[entryId],
  text
 };
}

test('AleCore AI Cloud origin accepts HTTPS and loopback only',()=>{
 assert.equal(normalizeOrigin(origin),origin);
 assert.equal(normalizeOrigin('http://127.0.0.1:4200'),'http://127.0.0.1:4200');
 assert.throws(()=>normalizeOrigin('http://example.test'),/HTTPS/);
 assert.throws(()=>normalizeOrigin('https://example.test/path'),/origin/);
 assert.throws(()=>normalizeOrigin('https://user:pass@example.test'),/origin/);
});

test('desktop AleCore AI Cloud bridge gets CSRF from Owner session and preserves preview approval flow',async()=>{
 const requests=[];
 const fakeFetch=async(input,init={})=>{
  const url=new URL(String(input));
  requests.push({url:url.pathname,init});
  if(url.pathname==='/api/me'){
   return new Response(JSON.stringify({
    authenticated:true,
    displayName:'Owner Test',
    csrfToken:csrf
   }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(url.pathname==='/api/humanale/status'){
   return new Response(JSON.stringify({
    available:true,
    version:1,
    maxEntries:6,
    maxChars:1600
   }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(url.pathname==='/api/humanale/context'){
   const body=JSON.parse(String(init.body||'{}'));
   if(body.approved===true){
    assert.deepEqual(body.entryIds,[entryId]);
    return new Response(JSON.stringify({context:packet(true)}),{
     status:200,
     headers:{'content-type':'application/json'}
    });
   }
   return new Response(JSON.stringify({
    preview:packet(false),
    context:null
   }),{status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:404});
 };

 const client=new AleCloudContextClient({
  origin,
  fetchImpl:fakeFetch,
  validateMemoryContext
 });

 const status=await client.status();
 assert.equal(status.configured,true);
 assert.equal(status.authenticated,true);
 assert.equal(status.available,true);
 assert.equal(status.displayName,'Owner Test');

 const previewResult=await client.context({
  target:'reasoner',
  mode:'ask',
  approved:false
 });
 assert.equal(previewResult.preview.approved,false);
 assert.deepEqual(previewResult.preview.entryIds,[entryId]);

 const approved=await client.context({
  target:'reasoner',
  mode:'ask',
  approved:true,
  entryIds:previewResult.preview.entryIds
 });
 assert.equal(approved.context.approved,true);
 assert.equal(approved.context.text,'[Project]\nMemory cloud aman.');

 const contextRequests=requests.filter(item=>item.url==='/api/humanale/context');
 assert.equal(contextRequests.length,2);
 for(const request of contextRequests){
  const headers=request.init.headers;
  assert.equal(headers['X-CSRF-Token'],csrf);
  assert.equal(headers.Origin,origin);
  assert.equal(headers.Referer,origin+'/');
  assert.equal(Object.hasOwn(headers,'Authorization'),false);
 }
});

test('desktop AleCore AI Cloud bridge reports login-required without inventing credentials',async()=>{
 const client=new AleCloudContextClient({
  origin,
  fetchImpl:async()=>new Response(JSON.stringify({error:'AUTHENTICATION_REQUIRED'}),{
   status:401,
   headers:{'content-type':'application/json'}
  }),
  validateMemoryContext
 });
 const status=await client.status();
 assert.equal(status.configured,true);
 assert.equal(status.authenticated,false);
 assert.equal(status.loginRequired,true);
 assert.equal(status.loginUrl,origin+'/');
});
