import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../ALECORE-AI/brain/event-bus.js';
import {
  LEARNING_PROPOSAL_TYPES,
  createLearningEngine
} from '../ALECORE-AI/learning/index.js';

test('Learning Engine records bounded execution metadata and computes reliability',()=>{
  let now=1000;
  const engine=createLearningEngine({now:()=>++now});
  engine.ingest({id:'s1',kind:'execution',skillId:'reason',outcome:'success',latencyMs:100,authority:'system'});
  engine.ingest({id:'s2',kind:'execution',skillId:'reason',outcome:'failure',latencyMs:200,authority:'system'});
  engine.ingest({id:'s3',kind:'execution',skillId:'reason',outcome:'success',latencyMs:150,authority:'system'});
  const skill=engine.skillSnapshot('reason');
  assert.equal(skill.counters.success,2);
  assert.equal(skill.counters.failure,1);
  assert.equal(skill.metrics.reliability,.6667);
  assert.equal(skill.metrics.failureRate,.3333);
  assert.equal(skill.metrics.meanLatencyMs,150);
  assert.equal(skill.metrics.p95LatencyMs,200);
});

test('Learning Engine rejects extra fields so raw payloads cannot enter learning history',()=>{
  const engine=createLearningEngine();
  assert.throws(()=>engine.ingest({
    id:'unsafe-1',
    kind:'execution',
    skillId:'reason',
    outcome:'success',
    authority:'system',
    input:{prompt:'DO_NOT_STORE'}
  }),/Unsupported learning signal field: input/);

  assert.throws(()=>engine.ingest({
    id:'unsafe-2',
    kind:'feedback',
    skillId:'reason',
    outcome:'neutral',
    authority:'owner',
    feedback:'positive',
    payload:{secret:'DO_NOT_STORE'}
  }),/Unsupported learning signal field: payload/);
  assert.equal(engine.snapshot().counters.rejected,2);
});

test('duplicate signal IDs are idempotent',()=>{
  const engine=createLearningEngine();
  const signal={id:'dup-1',kind:'execution',skillId:'plan',outcome:'success',authority:'system'};
  assert.equal(engine.ingest(signal).accepted,true);
  const duplicate=engine.ingest(signal);
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(engine.skillSnapshot('plan').counters.success,1);
  assert.equal(engine.snapshot().counters.duplicates,1);
});

test('weighted terminal metrics remain transparent and bounded to 0..1',()=>{
  const engine=createLearningEngine();
  engine.ingest({id:'w1',kind:'verification',skillId:'verify',outcome:'success',authority:'verifier',weight:1});
  engine.ingest({id:'w2',kind:'verification',skillId:'verify',outcome:'failure',authority:'verifier',weight:.5});
  const metrics=engine.skillSnapshot('verify').metrics;
  assert.equal(metrics.reliability,.6667);
  assert.equal(metrics.failureRate,.3333);
});

test('Learning Engine proposes reliability review but never auto-applies it',()=>{
  const engine=createLearningEngine({
    limits:{minSamplesForProposal:5,failureRateThreshold:.35}
  });
  for(let i=0;i<3;i++){
    engine.ingest({id:'fail-'+i,kind:'execution',skillId:'agent.manage',outcome:'failure',authority:'system'});
  }
  for(let i=0;i<2;i++){
    engine.ingest({id:'ok-'+i,kind:'execution',skillId:'agent.manage',outcome:'success',authority:'system'});
  }
  const proposals=engine.propose('agent.manage');
  assert.equal(proposals.length,1);
  assert.equal(proposals[0].type,LEARNING_PROPOSAL_TYPES.REVIEW_RELIABILITY);
  assert.equal(proposals[0].status,'review_required');
  assert.equal(proposals[0].requiresApproval,true);
  assert.equal(proposals[0].autoApply,false);
  assert.equal(typeof engine.apply,'undefined');
});

test('Learning Engine can create timeout and feedback review proposals independently',()=>{
  const timeoutEngine=createLearningEngine({
    limits:{minSamplesForProposal:4,timeoutRateThreshold:.25,failureRateThreshold:1}
  });
  timeoutEngine.ingest({id:'t1',kind:'execution',skillId:'slow',outcome:'timeout',authority:'system'});
  timeoutEngine.ingest({id:'t2',kind:'execution',skillId:'slow',outcome:'success',authority:'system'});
  timeoutEngine.ingest({id:'t3',kind:'execution',skillId:'slow',outcome:'success',authority:'system'});
  timeoutEngine.ingest({id:'t4',kind:'execution',skillId:'slow',outcome:'success',authority:'system'});
  assert.deepEqual(timeoutEngine.propose('slow').map(item=>item.type),[
    LEARNING_PROPOSAL_TYPES.REVIEW_TIMEOUT
  ]);

  const feedbackEngine=createLearningEngine({
    limits:{minSamplesForProposal:5,negativeFeedbackThreshold:.4}
  });
  for(let i=0;i<3;i++)feedbackEngine.recordFeedback({id:'neg-'+i,skillId:'voice',feedback:'negative'});
  for(let i=0;i<2;i++)feedbackEngine.recordFeedback({id:'pos-'+i,skillId:'voice',feedback:'positive'});
  assert.deepEqual(feedbackEngine.propose('voice').map(item=>item.type),[
    LEARNING_PROPOSAL_TYPES.REVIEW_FEEDBACK
  ]);
});

test('execution and verification adapters translate metadata without module coupling',()=>{
  const engine=createLearningEngine();
  engine.observeExecution({
    learningSignalId:'exec-adapter-1',
    skillId:'reason',
    status:'COMPLETED',
    durationMs:42,
    endedAt:5000
  });
  engine.observeVerification({
    id:'verify-adapter-1',
    skillId:'reason',
    ok:false,
    latencyMs:10,
    timestamp:5100
  });
  const skill=engine.skillSnapshot('reason');
  assert.equal(skill.counters.success,1);
  assert.equal(skill.counters.failure,1);
});

test('signal history is bounded while lifetime counters continue accumulating',()=>{
  const engine=createLearningEngine({
    limits:{maxSignalsPerSkill:3,maxGlobalSignals:4}
  });
  for(let i=0;i<6;i++){
    engine.ingest({
      id:'bounded-'+i,
      kind:'execution',
      skillId:'reason',
      outcome:'success',
      authority:'system'
    });
  }
  const skill=engine.skillSnapshot('reason');
  assert.equal(skill.sampleCount,3);
  assert.equal(skill.counters.success,6);
  assert.equal(engine.recentSignals({limit:20}).length,4);
});

test('learning Event Bus contains metadata only and no raw content field exists',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const engine=createLearningEngine({bus});
  engine.ingest({
    id:'event-1',
    kind:'execution',
    skillId:'reason',
    outcome:'failure',
    latencyMs:200,
    authority:'system',
    tags:['runtime']
  });
  const serialized=JSON.stringify(events);
  assert.match(serialized,/learning\.signal\.recorded/);
  assert.equal(serialized.includes('prompt'),false);
  assert.equal(serialized.includes('input'),false);
  assert.equal(serialized.includes('output'),false);
  assert.equal(serialized.includes('chain-of-thought'),false);
});

test('invalid latency, weight, tags and feedback fail closed',()=>{
  const engine=createLearningEngine({
    limits:{maxLatencyMs:100,maxTags:2}
  });
  assert.throws(()=>engine.ingest({
    id:'latency-bad',kind:'execution',skillId:'reason',outcome:'success',
    authority:'system',latencyMs:101
  }),/latencyMs/);
  assert.throws(()=>engine.ingest({
    id:'weight-bad',kind:'execution',skillId:'reason',outcome:'success',
    authority:'system',weight:2
  }),/weight/);
  assert.throws(()=>engine.ingest({
    id:'tags-bad',kind:'execution',skillId:'reason',outcome:'success',
    authority:'system',tags:['a','b','c']
  }),/tag limit/);
  assert.throws(()=>engine.ingest({
    id:'feedback-bad',kind:'feedback',skillId:'reason',outcome:'neutral',
    authority:'owner'
  }),/requires feedback/);
});

test('proposal history is review-only and bounded',()=>{
  const engine=createLearningEngine({
    limits:{
      minSamplesForProposal:1,
      failureRateThreshold:0,
      timeoutRateThreshold:1,
      negativeFeedbackThreshold:1,
      proposalHistoryLimit:2
    }
  });
  for(let i=0;i<3;i++){
    const skill='skill-'+i;
    engine.ingest({
      id:'proposal-signal-'+i,
      kind:'execution',
      skillId:skill,
      outcome:'failure',
      authority:'system'
    });
    engine.propose(skill);
  }
  const proposals=engine.recentProposals({limit:10});
  assert.equal(proposals.length,2);
  assert.ok(proposals.every(item=>item.status==='review_required'));
  assert.ok(proposals.every(item=>item.autoApply===false));
});
