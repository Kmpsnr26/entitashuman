import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapNaraConnections} from '../desktop/startup-connections.mjs';

test('NARA startup auto-attaches configured AI providers and arms bounded autopilot',async()=>{
  const events=[];
  const nara={dispatch:(event,payload)=>{events.push({event,payload});return {event,payload};}};
  const bridges={
    chatgpt:{status:async()=>({configured:true,mode:'chatgpt-login'})},
    copilot:{status:async()=>({configured:true,mode:'copilot-cli',verified:false})},
    openai:{status:async()=>({configured:false,mode:'openai-api',model:'gpt-test'})},
    gemini:{status:async()=>({configured:true,mode:'gemini-api',model:'gemini-test'})}
  };
  const agentHub={status:async()=>({
    projectRoot:'/repo',
    projectRootReady:true,
    agents:[
      {id:'codex',state:'configured',canRun:true,executable:true},
      {id:'github-copilot',state:'installed',canRun:true,executable:true},
      {id:'humanale-orchestrator',state:'configured',canRun:true,detail:'ready'}
    ]
  })};

  const result=await bootstrapNaraConnections({bridges,agentHub,nara,logger:{info(){},warn(){}}});
  assert.equal(result.providers.chatgpt.ready,true);
  assert.equal(result.providers.gemini.ready,true);
  assert.equal(result.providers.openai.ready,false);
  assert.equal(result.providers.codex.ready,true);
  assert.equal(result.providers.copilot.auth,'deferred');
  assert.equal(result.autopilot.ready,true);
  assert.equal(result.autopilot.armed,true);
  assert.deepEqual(result.autopilot.executors,['codex','github-copilot']);
  assert.equal(events.filter(item=>item.event==='provider.status').length,5);
  assert.equal(events.at(-1).event,'autopilot.status');
});

test('NARA startup fails closed when a provider status check throws',async()=>{
  const bridges={
    chatgpt:{status:async()=>{throw new Error('offline');}},
    copilot:{status:async()=>({configured:false})},
    openai:{status:async()=>({configured:false})},
    gemini:{status:async()=>({configured:false})}
  };
  const result=await bootstrapNaraConnections({bridges,agentHub:{status:async()=>({agents:[]})},logger:{info(){},warn(){}}});
  assert.equal(result.providers.chatgpt.ready,false);
  assert.equal(result.providers.chatgpt.attached,false);
  assert.match(result.providers.chatgpt.error,/offline/);
  assert.equal(result.providers.codex.ready,false);
  assert.equal(result.autopilot.ready,false);
});
