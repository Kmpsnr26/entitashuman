import test from 'node:test';
import assert from 'node:assert/strict';

import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {createNaraAgentCoordinator} from '../desktop/nara-agent-coordinator.mjs';

test('V3.2 coordinator turns a HumanALE agent request into Goal → Task → Autopilot → result',async()=>{
  const calls=[];
  const agentHub={
    async run(value){
      calls.push(value);
      return {id:value.id,name:'Fake Agent',mode:value.mode,text:'Selesai'};
    }
  };
  const nara=createOrchestrator();
  nara.start();
  const coordinator=createNaraAgentCoordinator({nara,agentHub}).bind();

  const result=await coordinator.run({
    id:'humanale-orchestrator',
    prompt:'Periksa integrasi runtime',
    mode:'analyze'
  });

  assert.equal(result.text,'Selesai');
  assert.equal(calls.length,1);
  assert.equal(calls[0].mode,'analyze');
  assert.match(result.nara.goalId,/^agent-goal-analyze-/);
  assert.match(result.nara.taskId,/^agent-task-analyze-/);
  assert.equal(result.nara.goalStatus,'complete');

  const snapshot=nara.snapshot();
  const goal=snapshot.engine.goals.goals.find(item=>item.id===result.nara.goalId);
  const task=snapshot.engine.autopilot.scheduler.tasks.find(item=>item.id===result.nara.taskId);
  assert.equal(goal.status,'complete');
  assert.equal(goal.progress,1);
  assert.equal(task.status,'complete');
  assert.equal(goal.label.includes('Periksa integrasi runtime'),false);
  assert.equal(task.label.includes('Periksa integrasi runtime'),false);
  assert.match(goal.label,/Agent humanale-orchestrator/);
  assert.ok(snapshot.engine.experience.strategies.some(item=>item.id==='humanale.agent.analyze'&&item.successes===1));
  assert.equal(coordinator.snapshot().pending,0);
  nara.stop();
});

test('V3.2 work mode remains inside registered Agent Hub handler and returns Core metadata',async()=>{
  let received=null;
  const agentHub={
    async run(value){
      received=value;
      return {id:value.id,name:'Worker',mode:value.mode,text:'Perubahan dan test selesai'};
    }
  };
  const nara=createOrchestrator();
  nara.start();
  const coordinator=createNaraAgentCoordinator({nara,agentHub});

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
  assert.equal(result.nara.goalStatus,'complete');
  const snapshot=nara.snapshot();
  assert.equal(snapshot.regions.PROGRAM.status,'complete');
  assert.equal(snapshot.regions.AGENT_MANAGER.status,'complete');
  assert.equal(snapshot.regions.FOLLOW_UP.status,'complete');
  nara.stop();
});

test('V3.2 agent failure flows into failed task, blocked goal, Error Monitor and metacognition',async()=>{
  const agentHub={
    async run(){
      const error=new Error('Login executor diperlukan');
      error.category='auth';
      throw error;
    }
  };
  const nara=createOrchestrator();
  nara.start();
  const coordinator=createNaraAgentCoordinator({nara,agentHub});

  const result=await coordinator.run({
    id:'codex',
    prompt:'Analisis repo',
    mode:'analyze'
  });

  assert.match(result.error,/Login executor diperlukan/);
  assert.equal(result.nara.goalStatus,'blocked');
  const snapshot=nara.snapshot();
  assert.equal(snapshot.engine.autopilot.scheduler.failed,1);
  assert.equal(snapshot.regions.ERROR_MONITOR.status,'error');
  assert.ok(['recover','verify'].includes(snapshot.engine.metacognition.recommendation));
  assert.equal(coordinator.snapshot().pending,0);
  nara.stop();
});

test('V3.2 validates request before mutating Goal Manager or scheduler',async()=>{
  const nara=createOrchestrator();
  nara.start();
  const coordinator=createNaraAgentCoordinator({
    nara,
    agentHub:{run:async()=>({text:'unused'})}
  });

  await assert.rejects(
    ()=>coordinator.run({id:'codex',prompt:'',mode:'analyze'}),
    /Prompt agent harus berisi/
  );
  const snapshot=nara.snapshot();
  assert.equal(snapshot.engine.goals.total,0);
  assert.equal(snapshot.engine.autopilot.scheduler.total,0);
  nara.stop();
});


test('V3.2 keeps raw prompt out of persisted Goal, Task and Experience snapshots',async()=>{
  const secretPrompt='PRIVATE-PROMPT-DO-NOT-PERSIST-9f3b7a';
  const nara=createOrchestrator();
  nara.start();
  const coordinator=createNaraAgentCoordinator({
    nara,
    agentHub:{run:async()=>({text:'ok'})}
  });

  const result=await coordinator.run({
    id:'codex',
    prompt:secretPrompt,
    mode:'analyze'
  });
  assert.equal(result.text,'ok');

  const serialized=JSON.stringify(nara.snapshot());
  assert.equal(serialized.includes(secretPrompt),false);
  assert.equal(coordinator.snapshot().pending,0);
  nara.stop();
});
