import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {
  createGoalManager,
  createMetacognitionEngine,
  createExperienceModel,
  createCapabilityBroker
} from '../nara-core/engine/index.js';
import {createExperienceStore} from '../nara-core/persistence/experience-store.mjs';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';

test('Goal Manager prioritizes ready goals and enforces dependencies',()=>{
  const goals=createGoalManager();
  goals.create({id:'foundation',label:'Foundation',priority:20});
  goals.create({id:'dependent',label:'Dependent',priority:100,dependencies:['foundation']});
  goals.create({id:'independent',label:'Independent',priority:60});

  assert.equal(goals.next().id,'independent');
  goals.complete('independent');
  assert.equal(goals.next().id,'foundation');
  goals.complete('foundation');
  assert.equal(goals.next().id,'dependent');
});

test('Goal Manager derives bounded progress from linked scheduler tasks',()=>{
  const goals=createGoalManager();
  goals.create({id:'release',label:'Release'});
  goals.activate('release');
  goals.attachTask('release','task-a');
  goals.attachTask('release','task-b');

  let changes=goals.reconcileTasks([
    {id:'task-a',status:'complete'},
    {id:'task-b',status:'queued'}
  ]);
  assert.equal(changes.length,1);
  assert.equal(goals.get('release').status,'active');
  assert.equal(goals.get('release').progress,.5);

  changes=goals.reconcileTasks([
    {id:'task-a',status:'complete'},
    {id:'task-b',status:'complete'}
  ]);
  assert.equal(changes.length,1);
  assert.equal(goals.get('release').status,'complete');
  assert.equal(goals.get('release').progress,1);
});

test('Goal Manager marks a goal blocked when a linked task fails',()=>{
  const goals=createGoalManager();
  goals.create({id:'repair',label:'Repair'});
  goals.activate('repair');
  goals.attachTask('repair','fix');
  goals.reconcileTasks([{id:'fix',status:'failed'}]);
  assert.equal(goals.get('repair').status,'blocked');
});

test('Metacognition exposes operational metrics and never private reasoning',()=>{
  const engine=createMetacognitionEngine();
  const capabilities=createCapabilityBroker();
  capabilities.request('creator.login.change',{reason:'Rotate owner login'});

  const result=engine.evaluate({
    brain:{regions:{ERROR_MONITOR:{status:'error'}}},
    sensory:{server:{health:'degraded'}},
    goals:{
      goals:[
        {id:'g1',status:'active'},
        {id:'g2',status:'blocked'}
      ]
    },
    autopilot:{
      scheduler:{
        tasks:[
          {id:'t1',status:'running'},
          {id:'t2',status:'failed'}
        ]
      }
    },
    capabilities:capabilities.snapshot(),
    experience:{strategies:[]}
  });

  assert.ok(result.uncertainty>.4);
  assert.ok(result.confidence<.7);
  assert.equal(result.recommendation,'ask-owner');
  assert.ok(result.flags.includes('owner-approval-pending'));
  assert.equal(Object.hasOwn(result,'reasoning'),false);
  assert.equal(Object.hasOwn(result,'chainOfThought'),false);
  assert.equal(Object.hasOwn(result,'thoughts'),false);
});

test('Experience model restores only bounded safe strategy records',()=>{
  const model=createExperienceModel({limit:20});
  model.hydrate({
    version:1,
    strategies:[
      {id:'safe.one',runs:3,successes:2,failures:1,score:.7,updatedAt:123},
      {id:'../unsafe',runs:999,successes:999,failures:0,score:1,updatedAt:999}
    ],
    history:[
      {id:'safe.one',ok:true,durationMs:25,timestamp:123}
    ]
  });
  const snapshot=model.snapshot();
  assert.equal(snapshot.strategies.length,1);
  assert.equal(snapshot.strategies[0].id,'safe.one');
  assert.equal(snapshot.strategies[0].score,.7);
  assert.equal(model.choose(['safe.one']),'safe.one');
});

test('Persistent Experience Store saves and restores bounded NARA experience',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nara-experience-v22-'));
  const file=join(dir,'experience.json');
  try{
    const store=createExperienceStore({filePath:file});
    const model=createExperienceModel();
    model.record('strategy.fast',{ok:true,durationMs:20});
    model.record('strategy.safe',{ok:false,durationMs:45});

    await store.save(model.snapshot());
    const raw=readFileSync(file,'utf8');
    assert.equal(raw.includes('password'),false);
    assert.equal(raw.includes('token'),false);

    const restored=await store.load();
    const next=createExperienceModel();
    next.hydrate(restored);
    assert.equal(next.snapshot().strategies.length,2);
    assert.equal(next.snapshot().history.length,2);

    model.record('strategy.fast',{ok:true,durationMs:10});
    await store.save(model.snapshot());
    const again=await store.load();
    assert.ok(again.strategies.find(item=>item.id==='strategy.fast').runs>=2);

    model.record('strategy.safe',{ok:true,durationMs:12});
    store.saveSync(model.snapshot());
    const syncRaw=readFileSync(file,'utf8');
    assert.match(syncRaw,/strategy\.safe/);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Persistent Experience Store validates and reads through one pinned file handle',()=>{
  const source=readFileSync(new URL('../nara-core/persistence/experience-store.mjs',import.meta.url),'utf8');
  assert.match(source,/handle=await open\(this\.filePath,'r'\)/);
  assert.match(source,/await handle\.stat\(\)/);
  assert.match(source,/await handle\.readFile\(\{encoding:'utf8'\}\)/);
  assert.match(source,/await handle\?\.close\(\)/);
  assert.doesNotMatch(source,/\bstat\(this\.filePath\)/);
  assert.doesNotMatch(source,/\breadFile\(this\.filePath/);
});

test('NARA orchestrator links goals to autopilot tasks and completes goal automatically',async()=>{
  const nara=createOrchestrator();
  nara.start();
  nara.createGoal({id:'health-goal',label:'Verify health',priority:80});
  nara.activateGoal('health-goal');
  nara.registerAutopilotHandler('internal.health',async()=>({health:'ok'}));
  nara.queueAutopilotTask({
    id:'health-task',
    goalId:'health-goal',
    handler:'internal.health',
    priority:90
  });

  const result=await nara.runAutopilotOnce();
  assert.equal(result.ok,true);

  const snapshot=nara.snapshot();
  const goal=snapshot.engine.goals.goals.find(item=>item.id==='health-goal');
  assert.equal(goal.status,'complete');
  assert.equal(goal.progress,1);
  assert.equal(snapshot.engine.metacognition.version,1);
  assert.ok(['continue','verify','recover','ask-owner'].includes(snapshot.engine.metacognition.recommendation));
  assert.equal(snapshot.regions.PLANNER.status,'complete');
  nara.stop();
});


test('NARA rejects task-to-goal links before mutating the scheduler when goal is unknown',()=>{
  const nara=createOrchestrator();
  nara.start();
  nara.registerAutopilotHandler('safe.noop',async()=>({ok:true}));
  assert.throws(()=>nara.queueAutopilotTask({
    id:'orphan-task',
    goalId:'missing-goal',
    handler:'safe.noop'
  }),/Goal AleCore AI untuk task tidak ditemukan/);
  assert.equal(nara.snapshot().engine.autopilot.scheduler.total,0);
  nara.stop();
});

test('NARA metacognition requests owner attention when a protected capability is pending',()=>{
  const nara=createOrchestrator();
  nara.start();
  nara.requestCapability('creator.login.change',{reason:'Owner credential rotation'});
  const review=nara.reviewMetacognition();
  assert.equal(review.recommendation,'ask-owner');
  assert.ok(review.flags.includes('owner-approval-pending'));
  assert.equal(nara.snapshot().regions.SAFETY.status,'paused');
  nara.stop();
});
