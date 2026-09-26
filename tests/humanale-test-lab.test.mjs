import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {getHumanALETestScenario,listHumanALETestScenarios,HUMANALE_TEST_SCENARIOS} from '../nara-core/brain/humanale-test-lab.js';

const ALLOWED_EVENTS=new Set([
 'hearing.start','hearing.stop','reason.start','reason.complete','speech.start','speech.stop',
 'work.start','work.complete','error.detected','diagnostic.reset'
]);

test('HumanALE controlled test lab exposes only bounded named scenarios',()=>{
 const list=listHumanALETestScenarios();
 assert.deepEqual(list.map(item=>item.id),['listening','thinking','speaking','processing','error','full']);
 assert.equal(getHumanALETestScenario('owner.secret'),null);
 assert.equal(getHumanALETestScenario('__proto__'),null);
 for(const scenario of Object.values(HUMANALE_TEST_SCENARIOS)){
  assert.ok(scenario.steps.length>=2&&scenario.steps.length<=10);
  assert.ok(scenario.steps.reduce((sum,step)=>sum+step.waitMs,0)<=3000);
  for(const step of scenario.steps){
   assert.ok(ALLOWED_EVENTS.has(step.event),step.event+' is not an allowed test event');
   assert.ok(step.waitMs>=0&&step.waitMs<=1200);
   assert.equal(step.payload?.source,'visual-studio-test');
  }
 }
});

test('NARA error test can recover to idle without leaving synthetic diagnostic errors',()=>{
 const nara=createOrchestrator();
 nara.start();
 const scenario=getHumanALETestScenario('error');
 for(const step of scenario.steps)nara.dispatch(step.event,step.payload,{source:'visual-studio-test'});
 const snap=nara.snapshot();
 assert.equal(snap.humanale.state,'idle');
 assert.equal(snap.humanale.rendererMode,'eco');
 assert.equal(snap.regions.ERROR_MONITOR.status,'ready');
 assert.equal(snap.regions.BUG_HUNTER.status,'ready');
 assert.equal(snap.currentTask,null);
});

test('NARA full test cycle covers all HumanALE runtime states and restores idle',()=>{
 const nara=createOrchestrator();
 nara.start();
 const scenario=getHumanALETestScenario('full');
 const states=[];
 for(const step of scenario.steps){
  let result;
  if(step.event==='work.start')result=nara.startWork(step.payload);
  else if(step.event==='work.complete')result=nara.completeWork(step.payload);
  else result=nara.dispatch(step.event,step.payload,{source:'visual-studio-test'});
  states.push(result.state.humanale.state);
 }
 for(const expected of ['listening','thinking','speaking','processing','error','idle'])assert.ok(states.includes(expected),expected);
 assert.equal(nara.snapshot().humanale.state,'idle');
 assert.equal(nara.snapshot().humanale.rendererMode,'eco');
});
