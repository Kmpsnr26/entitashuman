import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {bootstrapAleConnections,recordAleProviderStatus,recordAleAgentHubStatus} from '../desktop/startup-connections.mjs';
import {OpenAIBridge} from '../desktop/openai-api.mjs';
import {GeminiBridge} from '../desktop/gemini.mjs';
import {CopilotBridge} from '../desktop/copilot.mjs';
import {createOrchestrator} from '../alecore-ai/brain/index.js';
import {normalizeProviderStatus} from '../alecore-ai/brain/provider-state.js';

function hub(agents=[],projectRootReady=true){return {status:async()=>({agents,projectRootReady})};}
function aleFixture(){const ale=createOrchestrator();ale.start();return ale;}

test('refreshed workspace evidence retains CLI login but reports blocked work until checkout is ready',()=>{
  const ale=aleFixture();
  try{
    const agents=[{id:'codex',state:'configured',canRun:true,executable:true}];
    const blocked=recordAleAgentHubStatus({ale,hub:{agents,projectRootReady:true,workReady:false},now:()=>1});
    assert.equal(blocked.provider.ready,true);
    assert.equal(blocked.startupConnections.projectRootReady,false);
    const ready=recordAleAgentHubStatus({ale,hub:{agents,projectRootReady:true,workReady:true},now:()=>2});
    assert.equal(ready.startupConnections.projectRootReady,true);
    assert.equal(ale.snapshot().startupConnections.checkedAt,2);
    assert.equal(ale.snapshot().startupConnections.armed,false);
  }finally{ale.stop();}
});

test('CLI probe failures remain unknown in Core rather than being labeled logged out',()=>{
  for(const [errorCode,statusError] of [['CODEX_PROBE_ENOENT','STATUS_FAILED'],['CODEX_PROBE_TIMEOUT','STATUS_TIMEOUT']]){
    const result=recordAleAgentHubStatus({hub:{agents:[{id:'codex',executable:true,state:'installed',canRun:false,errorCode}]}});
    assert.equal(result.provider.auth,'unknown');assert.equal(result.provider.statusError,statusError);
  }
});

test('actual API bridge configuration checks never make a request or prove authentication',async()=>{
  const names=['OPENAI_API_KEY','GEMINI_API_KEY'];
  const previous=names.map(name=>process.env[name]);
  const marker='LOCAL_ONLY_TEST_KEY_DO_NOT_PUBLISH';
  let requests=0;
  try{
    for(const name of names)process.env[name]=marker;
    const fetchImpl=()=>{requests++;throw new Error('No provider request allowed in this test');};
    const ale=aleFixture();
    const schedulerBefore=ale.snapshot().engine.autopilot;
    const result=await bootstrapAleConnections({
      bridges:{openai:new OpenAIBridge(fetchImpl),gemini:new GeminiBridge(fetchImpl)},
      agentHub:hub(),ale
    });
    for(const id of ['openai','gemini']){
      assert.equal(result.providers[id].configured,true);
      assert.equal(result.providers[id].ready,false);
      assert.equal(result.providers[id].verified,false);
      assert.equal(result.providers[id].auth,'unverified');
    }
    assert.equal(requests,0);
    assert.ok(!JSON.stringify(result).includes(marker));
    assert.deepEqual(ale.snapshot().engine.autopilot,schedulerBefore);
    assert.equal(ale.snapshot().startupConnections.armed,false);
    ale.stop();
  }finally{
    names.forEach((name,i)=>previous[i]===undefined?delete process.env[name]:process.env[name]=previous[i]);
  }
});

test('Copilot --version proves installation only and bootstrap never invokes login or prompts',async()=>{
  const calls=[];
  const copilot=new CopilotBridge({
    findExecutable:async()=>'fake-copilot',
    runImpl:async(_executable,args)=>{
      calls.push(args);
      return {code:0,stdout:'copilot test version',stderr:''};
    }
  });
  const result=await bootstrapAleConnections({bridges:{copilot},agentHub:hub([
    {id:'github-copilot',state:'installed',canRun:true,executable:true},
    {id:'cursor',state:'installed',canRun:true,executable:true},
    {id:'humanale-orchestrator',canRun:true}
  ])});
  assert.deepEqual(calls,[['--version']]);
  assert.equal(result.providers.copilot.configured,true);
  assert.equal(result.providers.copilot.ready,false);
  assert.equal(result.providers.copilot.auth,'unverified');
  assert.deepEqual(result.startupConnections.authenticatedExecutors,[]);
  assert.equal(result.startupConnections.armed,false);
});

test('local ChatGPT/Codex login evidence is recorded without arming a maintenance worker',async()=>{
  const ale=aleFixture();
  const result=await bootstrapAleConnections({
    bridges:{chatgpt:{status:async()=>({configured:true})}},
    agentHub:hub([{id:'codex',state:'configured',canRun:true,executable:true}]),
    ale,now:()=>1234
  });
  assert.equal(result.providers.chatgpt.ready,true);
  assert.equal(result.providers.codex.ready,true);
  assert.equal(result.providers.codex.evidence,'login-status');
  assert.deepEqual(result.startupConnections.authenticatedExecutors,['codex']);
  assert.equal(result.startupConnections.checkedAt,1234);
  assert.equal(result.startupConnections.mode,'manual');
  assert.equal(result.startupConnections.armed,false);
  assert.equal(result.startupConnections.realtime,false);
  assert.equal(ale.snapshot().humanale.state,'idle');
  ale.stop();
});

test('busy bridges do not become ready from cached configuration',async()=>{
  const result=await bootstrapAleConnections({
    bridges:{chatgpt:{pending:true,status:async()=>({configured:true,busy:true})},
      copilot:{pending:true,status:async()=>({configured:true,verified:true})}},
    agentHub:{pending:true,status:async()=>({agents:[{id:'codex',state:'configured',executable:true,canRun:true}]})}
  });
  assert.equal(result.providers.chatgpt.verified,false);
  for(const id of ['chatgpt','copilot','codex'])assert.equal(result.providers[id].ready,false);
  assert.deepEqual(result.startupConnections.authenticatedExecutors,[]);
});

test('errors/timeouts publish unknown observations without leaking diagnostic text',async()=>{
  const ale=aleFixture();
  const marker='DO_NOT_PUBLISH_RAW_CREDENTIAL_DIAGNOSTIC';
  const result=await bootstrapAleConnections({
    bridges:{copilot:{status:async()=>{throw new Error(marker);}},
      chatgpt:{status:()=>new Promise(()=>{})}},
    agentHub:{status:async()=>{throw new Error(marker);}},
    ale,timeoutMs:10
  });
  assert.equal(result.providers.copilot.auth,'unknown');
  assert.equal(result.providers.copilot.statusError,'STATUS_FAILED');
  assert.equal(result.providers.chatgpt.statusError,'STATUS_TIMEOUT');
  assert.equal(result.providers.codex.auth,'unknown');
  assert.equal(result.startupConnections.pending,false);
  assert.equal(ale.snapshot().regions.COPILOT.status,'paused');
  assert.ok(!JSON.stringify(ale.bus.recent()).includes(marker));
  ale.stop();
});

test('public provider metadata excludes arbitrary models, keys, payloads and false verification claims',()=>{
  const ale=aleFixture();
  const marker='DO_NOT_PUBLISH_PROVIDER_PAYLOAD';
  const provider=recordAleProviderStatus({ale,id:'openai',raw:{configured:true,
    verified:true,ready:true,mode:marker,model:marker,apiKey:marker,stdout:marker,error:marker}});
  assert.equal(provider.ready,false);
  assert.equal(provider.mode,'openai-api');
  assert.equal(normalizeProviderStatus({id:'__proto__',verified:true}),null);
  const snapshot=ale.snapshot();
  assert.ok(!JSON.stringify(snapshot).includes(marker));
  snapshot.providers.openai.ready=true;
  snapshot.startupConnections.authenticatedExecutors.push('rogue');
  assert.equal(ale.snapshot().providers.openai.ready,false);
  assert.deepEqual(ale.snapshot().startupConnections.authenticatedExecutors,[]);
  ale.stop();
});

test('Copilot verification is invalidated after a failed request or a new login attempt',async()=>{
  let fail=false;
  const bridge=new CopilotBridge({findExecutable:async()=>'fake-copilot',
    runImpl:async(_executable,args)=>{
      if(args[0]==='--version'||args[0]==='login')return {code:0,stdout:'ok',stderr:''};
      return fail?{code:1,stdout:'',stderr:'unauthorized'}:{code:0,stdout:'hello',stderr:''};
    }
  });
  await bridge.ask({message:'local fixture',history:[]});
  assert.equal((await bridge.status()).verified,true);
  fail=true;
  await assert.rejects(()=>bridge.ask({message:'local fixture',history:[]}),/perlu login/);
  assert.equal((await bridge.status()).verified,false);
  fail=false;
  await bridge.ask({message:'local fixture',history:[]});
  await bridge.login();
  assert.equal((await bridge.status()).verified,false);
});

test('provider bootstrap can complete after AleCore AI shutdown without throwing or executing work',async()=>{
  const ale=aleFixture();
  ale.stop();
  const result=await bootstrapAleConnections({ale,agentHub:hub()});
  assert.equal(result.startupConnections.armed,false);
  assert.equal(ale.snapshot().lifecycle,'offline');
});

test('provider observations preserve an active reasoning policy while startup checks finish',async()=>{
  const ale=aleFixture();
  ale.dispatch('reason.start',{label:'existing owner request'});
  const policy=ale.snapshot().humanale;
  await bootstrapAleConnections({ale,agentHub:hub(),bridges:{openai:{status:async()=>({configured:true})}}});
  assert.deepEqual(ale.snapshot().humanale,policy);
  recordAleProviderStatus({ale,id:'openai',requestSucceeded:true});
  assert.deepEqual(ale.snapshot().humanale,policy);
  ale.stop();
});

test('desktop status UI distinguishes unknown checks, local login and historical request evidence',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const functionSource=source.slice(source.indexOf('async function checkAI(){'),source.indexOf('async function loadAgents(){'));
  const elements=new Map();
  const context={aiProvider:'chatgpt',aiReady:false,cameraStream:null,
    desktop:{status:async()=>({configured:false,statusError:'STATUS_FAILED'})},
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
    stopCamera(){throw new Error('Unexpected camera operation');}
  };
  vm.createContext(context);
  vm.runInContext(functionSource,context);
  await context.checkAI();
  assert.match(elements.get('#aiStatus').textContent,/status belum dapat dipastikan/);
  assert.doesNotMatch(elements.get('#aiStatus').textContent,/Login.*diperlukan/);
  context.desktop.status=async()=>({configured:true,busy:true,verified:false});
  await context.checkAI();
  assert.match(elements.get('#aiStatus').textContent,/sesi belum diverifikasi/);
  context.desktop.status=async()=>({configured:true,verified:true,evidence:'login-status'});
  await context.checkAI();
  assert.match(elements.get('#aiStatus').textContent,/login lokal terverifikasi/);
  for(const provider of ['chatgpt','openai','gemini','copilot']){
    context.aiProvider=provider;
    context.desktop.status=async()=>({configured:true,verified:true,evidence:'successful-request'});
    await context.checkAI();
    assert.match(elements.get('#aiStatus').textContent,/permintaan sebelumnya berhasil/);
    assert.doesNotMatch(elements.get('#aiStatus').textContent,/terhubung|login aktif/);
  }
  context.aiProvider='openai';
  context.desktop.status=async()=>({configured:true,verified:false});
  await context.checkAI();
  assert.match(elements.get('#aiStatus').textContent,/siap diuji/);
  assert.equal(context.aiReady,true);
});

async function providerIpcFixture(){
  const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const source=main.slice(main.indexOf('  const pickProvider='),main.indexOf("  ipcMain.handle('dudidam:stt-status'"));
  const handlers=new Map();
  const ale=aleFixture();
  let response={text:'usable response'},statusCalls=0,askCalls=0,loginCalls=0,allowed=true,configured=true;
  const bridge={
    status:async()=>{statusCalls++;return {configured};},
    ask:async()=>{askCalls++;if(response instanceof Error)throw response;return response;},
    login:async()=>{loginCalls++;return {ok:true};}
  };
  const context={ale,bridges:{openai:bridge,gemini:bridge,copilot:bridge,chatgpt:bridge},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    ownerTrusted:()=>allowed,recordAleProviderStatus,
    validateMemoryContext:()=>null,dataFlowMeter:{recordIn(){},recordOut(){}}
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return {ale,handlers,set response(value){response=value;},set allowed(value){allowed=value;},
    set configured(value){configured=value;},get statusCalls(){return statusCalls;},
    get askCalls(){return askCalls;},get loginCalls(){return loginCalls;}};
}

test('production owner-gated ask records usable API success, preserves it on local polls, clears on failure',async()=>{
  for(const id of ['openai','gemini']){
    const fx=await providerIpcFixture();
    const ask=fx.handlers.get('dudidam:ask'),status=fx.handlers.get('dudidam:status');
    assert.equal((await ask({}, {provider:id,message:'fixture'})).text,'usable response');
    let provider=fx.ale.snapshot().providers[id];
    assert.equal(provider.ready,true);
    assert.equal(provider.evidence,'successful-request');
    assert.equal(fx.statusCalls,0,'successful ask must not add a status call');
    provider=await status({},id);
    assert.equal(provider.verified,true,'configuration-only poll preserves session evidence');
    const marker='DO_NOT_STORE_PROVIDER_ERROR';
    fx.response=new Error(marker);
    await ask({}, {provider:id,message:'fixture'});
    provider=fx.ale.snapshot().providers[id];
    assert.equal(provider.configured,true);
    assert.equal(provider.verified,false);
    assert.equal(provider.auth,'unknown');
    assert.ok(!JSON.stringify(fx.ale.bus.recent()).includes(marker));
    provider=await status({},id);
    assert.equal(provider.auth,'unknown','configuration alone cannot erase failed-request uncertainty');
    fx.response={text:'recovered'};
    await ask({}, {provider:id,message:'fixture'});
    assert.equal(fx.ale.snapshot().providers[id].ready,true);
    assert.equal(fx.ale.snapshot().startupConnections.armed,false);
    fx.configured=false;
    provider=await status({},id);
    assert.equal(provider.verified,false);
    assert.equal(provider.auth,'missing');
    fx.ale.stop();
  }
});

test('production ask rejects empty/malformed/error responses as verification evidence and respects owner denial',async()=>{
  const fx=await providerIpcFixture();
  const ask=fx.handlers.get('dudidam:ask');
  for(const response of [null,{}, {text:' '}, {text:42}, {text:'partial',error:'DO_NOT_STORE_RETURNED_ERROR'}]){
    fx.response=response;
    const result=await ask({}, {provider:'openai',message:'fixture'});
    assert.ok(result.error);
    assert.equal(fx.ale.snapshot().providers.openai.verified,false);
  }
  assert.ok(!JSON.stringify(fx.ale.bus.recent()).includes('DO_NOT_STORE_RETURNED_ERROR'));
  const calls=fx.askCalls;
  const snapshot=fx.ale.snapshot();
  fx.allowed=false;
  await ask({}, {provider:'openai',message:'fixture'});
  await fx.handlers.get('dudidam:status')({},'openai');
  await fx.handlers.get('dudidam:login')({});
  assert.equal(fx.askCalls,calls);
  assert.equal(fx.statusCalls,0);
  assert.equal(fx.loginCalls,0);
  assert.deepEqual(fx.ale.snapshot(),snapshot);
  fx.ale.stop();
});

test('production login clears earlier successful request evidence, store is isolated by runtime/provider',async()=>{
  const fx=await providerIpcFixture();
  const ask=fx.handlers.get('dudidam:ask');
  await ask({}, {provider:'copilot',message:'fixture'});
  await ask({}, {provider:'openai',message:'fixture'});
  await fx.handlers.get('dudidam:login-copilot')({});
  assert.equal(fx.ale.snapshot().providers.copilot.verified,false);
  assert.equal(fx.ale.snapshot().providers.openai.verified,true);
  const second=await providerIpcFixture();
  assert.equal((await second.handlers.get('dudidam:status')({},'openai')).verified,false);
  assert.equal(recordAleProviderStatus({ale:fx.ale,id:'arbitrary-provider',requestSucceeded:true}),null);
  fx.ale.stop();second.ale.stop();
});
