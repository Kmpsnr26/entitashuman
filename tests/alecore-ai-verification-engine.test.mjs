import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../ALECORE-AI/brain/event-bus.js';
import {
  VERIFICATION_VERDICTS,
  VERIFICATION_REASONS,
  createVerificationEngine
} from '../ALECORE-AI/verification/index.js';

const execution=(overrides={})=>({
  executionId:'exec-1',
  skillId:'reason',
  status:'COMPLETED',
  ...overrides
});

test('Verification Engine passes when every registered verifier passes',async()=>{
  const engine=createVerificationEngine();
  engine.register({id:'shape',handler:artifact=>({ok:typeof artifact.answer==='number',code:'ANSWER_NUMBER',summary:'answer is numeric'})});
  engine.register({id:'positive',handler:artifact=>artifact.answer>0});
  const report=await engine.verify({
    verificationId:'verify-1',
    execution:execution(),
    artifact:{answer:42},
    verifierIds:['shape','positive']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.PASS);
  assert.equal(report.checks.length,2);
  assert.ok(report.checks.every(check=>check.ok));
});

test('Verification Engine reports FAIL for normal check failure without repairing or retrying',async()=>{
  let runs=0;
  const engine=createVerificationEngine();
  engine.register({id:'expected',handler:()=>{runs++;return {ok:false,code:'EXPECTED_MISSING',summary:'expected value missing'};}});
  const report=await engine.verify({
    verificationId:'verify-fail',
    execution:execution(),
    artifact:{answer:0},
    verifierIds:['expected']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.FAIL);
  assert.equal(report.reason,VERIFICATION_REASONS.CHECK_FAILED);
  assert.equal(runs,1);
  assert.equal(typeof engine.repair,'undefined');
  assert.equal(typeof engine.retry,'undefined');
});

test('Verification Engine blocks non-completed executions before checks run',async()=>{
  let ran=false;
  const engine=createVerificationEngine();
  engine.register({id:'shape',handler:()=>{ran=true;return true;}});
  const report=await engine.verify({
    verificationId:'verify-blocked',
    execution:execution({status:'FAILED'}),
    artifact:{answer:1},
    verifierIds:['shape']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.BLOCKED);
  assert.equal(report.reason,VERIFICATION_REASONS.EXECUTION_NOT_COMPLETED);
  assert.equal(ran,false);
});

test('unknown and disabled verifiers fail closed',async()=>{
  const engine=createVerificationEngine();
  const unknown=await engine.verify({
    verificationId:'verify-unknown',
    execution:execution(),
    artifact:{},
    verifierIds:['missing']
  });
  assert.equal(unknown.reason,VERIFICATION_REASONS.VERIFIER_NOT_REGISTERED);

  engine.register({id:'disabled',enabled:false,handler:()=>true});
  const disabled=await engine.verify({
    verificationId:'verify-disabled',
    execution:execution(),
    artifact:{},
    verifierIds:['disabled']
  });
  assert.equal(disabled.reason,VERIFICATION_REASONS.VERIFIER_DISABLED);
});

test('artifact must be finite JSON and stay inside byte budget',async()=>{
  const engine=createVerificationEngine({limits:{maxArtifactBytes:64}});
  engine.register({id:'shape',handler:()=>true});
  const cyclic={};
  cyclic.self=cyclic;
  const invalid=await engine.verify({
    verificationId:'verify-cyclic',
    execution:execution(),
    artifact:cyclic,
    verifierIds:['shape']
  });
  assert.equal(invalid.reason,VERIFICATION_REASONS.INVALID_ARTIFACT);

  const large=await engine.verify({
    verificationId:'verify-large',
    execution:execution(),
    artifact:{text:'x'.repeat(200)},
    verifierIds:['shape']
  });
  assert.equal(large.reason,VERIFICATION_REASONS.ARTIFACT_TOO_LARGE);
});

test('verifier timeout produces ERROR and cooperative abort',async()=>{
  let aborted=false;
  const engine=createVerificationEngine({
    limits:{defaultTimeoutMs:20,maxTimeoutMs:100}
  });
  engine.register({
    id:'slow',
    timeoutMs:20,
    handler:async(_artifact,{signal})=>new Promise(resolve=>{
      signal.addEventListener('abort',()=>{aborted=true;resolve(true);},{once:true});
    })
  });
  const report=await engine.verify({
    verificationId:'verify-timeout',
    execution:execution(),
    artifact:{},
    verifierIds:['slow']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.ERROR);
  assert.equal(report.reason,VERIFICATION_REASONS.CHECK_TIMEOUT);
  assert.equal(aborted,true);
});

test('verifier exceptions become bounded ERROR reports without leaking exception text',async()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const engine=createVerificationEngine({bus});
  engine.register({id:'boom',handler:()=>{throw new Error('SECRET_EXCEPTION_TEXT');}});
  const report=await engine.verify({
    verificationId:'verify-error',
    execution:execution(),
    artifact:{private:'ARTIFACT_SECRET'},
    verifierIds:['boom']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.ERROR);
  assert.equal(report.reason,VERIFICATION_REASONS.CHECK_ERROR);
  const serialized=JSON.stringify({report,events});
  assert.equal(serialized.includes('SECRET_EXCEPTION_TEXT'),false);
  assert.equal(serialized.includes('ARTIFACT_SECRET'),false);
});

test('global verification concurrency limit blocks excess verification',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const engine=createVerificationEngine({
    limits:{maxConcurrent:1,defaultTimeoutMs:1000,maxTimeoutMs:1000}
  });
  engine.register({id:'hold',handler:async()=>{await gate;return true;}});
  const first=engine.verify({
    verificationId:'verify-concurrent-1',
    execution:execution({executionId:'exec-a'}),
    artifact:{},
    verifierIds:['hold']
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await engine.verify({
    verificationId:'verify-concurrent-2',
    execution:execution({executionId:'exec-b'}),
    artifact:{},
    verifierIds:['hold']
  });
  assert.equal(second.verdict,VERIFICATION_VERDICTS.BLOCKED);
  assert.equal(second.reason,VERIFICATION_REASONS.CONCURRENCY_LIMIT);
  release();
  assert.equal((await first).verdict,VERIFICATION_VERDICTS.PASS);
});

test('active verifier cannot be unregistered',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const engine=createVerificationEngine({
    limits:{defaultTimeoutMs:1000,maxTimeoutMs:1000}
  });
  engine.register({id:'hold',handler:async()=>{await gate;return true;}});
  const run=engine.verify({
    verificationId:'verify-active',
    execution:execution(),
    artifact:{},
    verifierIds:['hold']
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.throws(()=>engine.unregister('hold'),/while active/);
  release();
  await run;
  assert.equal(engine.unregister('hold'),true);
});

test('PASS and FAIL reports convert to metadata-only learning signals',async()=>{
  const engine=createVerificationEngine({now:()=>5000});
  engine.register({id:'pass',handler:()=>true});
  engine.register({id:'fail',handler:()=>false});

  const passed=await engine.verify({
    verificationId:'verify-learn-pass',
    execution:execution(),
    artifact:{raw:'DO_NOT_COPY'},
    verifierIds:['pass']
  });
  const passSignal=engine.toLearningSignal(passed);
  assert.equal(passSignal.kind,'verification');
  assert.equal(passSignal.outcome,'success');
  assert.equal(JSON.stringify(passSignal).includes('DO_NOT_COPY'),false);

  const failed=await engine.verify({
    verificationId:'verify-learn-fail',
    execution:execution({executionId:'exec-2'}),
    artifact:{},
    verifierIds:['fail']
  });
  assert.equal(engine.toLearningSignal(failed).outcome,'failure');

  const blocked=await engine.verify({
    verificationId:'verify-learn-blocked',
    execution:execution({executionId:'exec-3',status:'FAILED'}),
    artifact:{},
    verifierIds:['pass']
  });
  assert.equal(engine.toLearningSignal(blocked),null);
});

test('verification history and Event Bus never retain artifact content',async()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const engine=createVerificationEngine({bus});
  engine.register({id:'shape',handler:artifact=>Boolean(artifact.ok)});
  await engine.verify({
    verificationId:'verify-privacy',
    requestId:'request-privacy',
    execution:execution(),
    artifact:{ok:true,private:'DO_NOT_RETAIN'},
    verifierIds:['shape']
  });
  const serialized=JSON.stringify({snapshot:engine.snapshot(),events});
  assert.equal(serialized.includes('DO_NOT_RETAIN'),false);
  assert.match(serialized,/verification\.start/);
  assert.match(serialized,/verification\.complete/);
});


test('verifier-provided summaries cannot copy artifact content into reports',async()=>{
  const engine=createVerificationEngine();
  engine.register({
    id:'summary-guard',
    handler:artifact=>({
      ok:true,
      code:'SAFE_CODE',
      summary:artifact.private
    })
  });
  const report=await engine.verify({
    verificationId:'verify-summary-guard',
    execution:execution(),
    artifact:{private:'ARTIFACT_TEXT_MUST_NOT_BE_STORED'},
    verifierIds:['summary-guard']
  });
  assert.equal(report.verdict,VERIFICATION_VERDICTS.PASS);
  assert.equal(report.checks[0].summary,'Verification passed.');
  assert.equal(JSON.stringify(report).includes('ARTIFACT_TEXT_MUST_NOT_BE_STORED'),false);
});
