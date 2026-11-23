import test from 'node:test';
import assert from 'node:assert/strict';

import {createOrchestrator} from '../alecore-ai/brain/orchestrator.js';
import {createAleAgentCoordinator,ALECORE_AI_AGENT_HANDLER_TIMEOUTS} from '../desktop/alecore-ai-agent-coordinator.mjs';

test('write refusal with zero changes blocks work instead of claiming completion or retrying',async()=>{
  let calls=0;const ale=createOrchestrator();ale.start();
  try{
    const agentHub={run:async()=>{calls++;return {mode:'work',text:'Tidak dapat menulis.',maintenance:{changedFiles:0}};}};
    const result=await createAleAgentCoordinator({ale,agentHub}).run({id:'codex',mode:'work',prompt:'Edit program'});
    assert.match(result.error,/belum menghasilkan perubahan/);
    assert.equal(calls,1);
    assert.notEqual(result.ale.goalStatus,'complete');
    assert.notEqual(ale.snapshot().regions.PROGRAM.status,'complete');
  }finally{ale.stop();}
});

test('V3.2 coordinator turns a HumanALE agent request into Goal → Task → Autopilot → result',async()=>{
  const calls=[];
  const agentHub={
    async run(value){
      calls.push(value);
      return {id:value.id,name:'Fake Agent',mode:value.mode,text:'Selesai'};
    }
  };
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({ale,agentHub}).bind();

  const result=await coordinator.run({
    id:'humanale-orchestrator',
    prompt:'Periksa integrasi runtime',
    mode:'analyze'
  });

  assert.equal(result.text,'Selesai');
  assert.equal(calls.length,1);
  assert.equal(calls[0].mode,'analyze');
  assert.match(result.ale.goalId,/^agent-goal-analyze-/);
  assert.match(result.ale.taskId,/^agent-task-analyze-/);
  assert.equal(result.ale.goalStatus,'complete');

  const snapshot=ale.snapshot();
  const goal=snapshot.engine.goals.goals.find(item=>item.id===result.ale.goalId);
  const task=snapshot.engine.autopilot.scheduler.tasks.find(item=>item.id===result.ale.taskId);
  assert.equal(goal.status,'complete');
  assert.equal(goal.progress,1);
  assert.equal(task.status,'complete');
  assert.equal(goal.label.includes('Periksa integrasi runtime'),false);
  assert.equal(task.label.includes('Periksa integrasi runtime'),false);
  assert.match(goal.label,/Agent humanale-orchestrator/);
  assert.ok(snapshot.engine.experience.strategies.some(item=>item.id==='humanale.agent.analyze'&&item.successes===1));
  assert.equal(coordinator.snapshot().pending,0);
  ale.stop();
});

test('V3.2 work mode remains inside registered Agent Hub handler and returns Core metadata',async()=>{
  let received=null;
  const agentHub={
    async run(value){
      received=value;
      return {
        id:value.id,name:'Worker',mode:value.mode,text:'Perubahan dan test selesai',
        maintenance:{changedFiles:1},
        stages:[{role:'reviewer',text:'Pemeriksaan independen selesai. VERDICT: PASS'}]
      };
    }
  };
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({ale,agentHub});

  const result=await coordinator.run({
    id:'github-copilot',
    prompt:'Perbaiki test yang gagal',
    mode:'work',
    memoryContext:{version:1,target:'agent',count:1,chars:12,entries:[]}
  });

  assert.equal(received.id,'github-copilot');
  assert.equal(received.mode,'work');
  assert.equal(received.prompt,'Perbaiki test yang gagal');
  assert.equal(received.memoryContext.target,'agent');
  assert.equal(result.ale.goalStatus,'complete');
  const snapshot=ale.snapshot();
  assert.equal(snapshot.regions.PROGRAM.status,'complete');
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'complete');
  assert.equal(snapshot.regions.FOLLOW_UP.status,'complete');
  ale.stop();
});

test('V3.2 agent failure flows into failed task, blocked goal, Error Monitor and metacognition',async()=>{
  const agentHub={
    async run(){
      const error=new Error('Login executor diperlukan');
      error.category='auth';
      throw error;
    }
  };
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({ale,agentHub});

  const result=await coordinator.run({
    id:'codex',
    prompt:'Analisis repo',
    mode:'analyze'
  });

  assert.match(result.error,/Login executor diperlukan/);
  assert.equal(result.ale.goalStatus,'blocked');
  const snapshot=ale.snapshot();
  assert.equal(snapshot.engine.autopilot.scheduler.failed,1);
  assert.equal(snapshot.regions.ERROR_MONITOR.status,'error');
  assert.ok(['recover','verify'].includes(snapshot.engine.metacognition.recommendation));
  assert.equal(coordinator.snapshot().pending,0);
  ale.stop();
});

test('V3.2 validates request before mutating Goal Manager or scheduler',async()=>{
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({
    ale,
    agentHub:{run:async()=>({text:'unused'})}
  });

  await assert.rejects(
    ()=>coordinator.run({id:'codex',prompt:'',mode:'analyze'}),
    /Prompt agent harus berisi/
  );
  const snapshot=ale.snapshot();
  assert.equal(snapshot.engine.goals.total,0);
  assert.equal(snapshot.engine.autopilot.scheduler.total,0);
  ale.stop();
});

test('V3.2 keeps raw prompt out of persisted Goal, Task and Experience snapshots',async()=>{
  const secretPrompt='PRIVATE-PROMPT-DO-NOT-PERSIST-9f3b7a';
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({
    ale,
    agentHub:{run:async()=>({text:'ok'})}
  });

  const result=await coordinator.run({
    id:'codex',
    prompt:secretPrompt,
    mode:'analyze'
  });
  assert.equal(result.text,'ok');

  const serialized=JSON.stringify(ale.snapshot());
  assert.equal(serialized.includes(secretPrompt),false);
  assert.equal(coordinator.snapshot().pending,0);
  ale.stop();
});

test('V3.2 successful bounded retry clears transient recovery warning',async()=>{
  let calls=0;
  const agentHub={
    async run(){
      calls+=1;
      if(calls===1)throw new Error('Gangguan sementara');
      return {text:'Pulih'};
    }
  };
  const ale=createOrchestrator();
  ale.start();
  const coordinator=createAleAgentCoordinator({ale,agentHub});

  const result=await coordinator.run({id:'codex',prompt:'Coba ulang',mode:'analyze'});

  assert.equal(calls,2);
  assert.equal(result.text,'Pulih');
  assert.equal(result.ale.goalStatus,'complete');
  const snapshot=ale.snapshot();
  assert.equal(snapshot.regions.ERROR_MONITOR.status,'complete');
  assert.equal(snapshot.regions.ERROR_MONITOR.lastEvent,'autopilot.task.recovered');
  assert.notEqual(snapshot.engine.metacognition.recommendation,'recover');
  ale.stop();
});


test('AleCore AI work handler deadline covers the complete sequential repair and final review pipeline',()=>{
  const registrations=new Map();
  const ale={
    registerAutopilotHandler(id,handler,options){registrations.set(id,{handler,options});},
    queueAutopilotTask(){},
    runAutopilotOnce(){}
  };
  const coordinator=createAleAgentCoordinator({ale,agentHub:{run:async()=>({text:'unused'})}});
  coordinator.bind();

  assert.equal(ALECORE_AI_AGENT_HANDLER_TIMEOUTS.analyzeMs,30*60*1000);
  assert.equal(ALECORE_AI_AGENT_HANDLER_TIMEOUTS.workMs,55*60*1000);
  assert.equal(registrations.get('humanale.agent.analyze').options.timeoutMs,30*60*1000);
  assert.equal(registrations.get('humanale.agent.work').options.timeoutMs,55*60*1000);
  assert.equal(registrations.get('humanale.agent.work').options.idempotent??false,false);
});
