import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  MAINTENANCE_AUTOPILOT_STATUS,
  SafeMaintenanceAutopilot
} from '../desktop/maintenance-autopilot.mjs';

async function fixture({
  hubBehavior='pass',
  verifierBehavior='pass'
}={}){
  const root=await mkdtemp(join(tmpdir(),'humanale-autopilot-'));
  let hubCalls=0,verifyCalls=0;

  const verifier={
    async verify(){
      verifyCalls++;
      if(verifierBehavior==='fail-once'&&verifyCalls===1){
        return {
          ok:false,
          profile:'full',
          failureCode:'CHECK_FAILED',
          checks:[{
            ok:false,
            failureCode:'CHECK_FAILED',
            failureTail:'test failed safely'
          }]
        };
      }
      if(verifierBehavior==='fail'){
        return {
          ok:false,
          profile:'full',
          failureCode:'CHECK_FAILED',
          checks:[{
            ok:false,
            failureCode:'CHECK_FAILED',
            failureTail:'OPENAI_API_KEY=sk-never-leak-123456'
          }]
        };
      }
      return {
        ok:true,
        profile:'full',
        durationMs:5,
        checks:[{id:'npm-verify',ok:true}]
      };
    }
  };

  const agentHub={
    async runMaintenanceVerified(value,trustedVerifier){
      hubCalls++;
      if(hubBehavior==='boundary'){
        const error=new Error('boundary');
        error.code='AI_MAINTENANCE_CHANGESET_BLOCKED';
        throw error;
      }
      const report=await trustedVerifier({
        cwd:root,
        transactionId:'tx-'+hubCalls,
        changedFiles:2,
        totalBytes:100
      });
      if(report.ok!==true){
        const error=new Error('verify failed');
        error.code='AI_MAINTENANCE_TRUSTED_VERIFY_FAILED';
        error.verification=report;
        throw error;
      }
      return {
        id:value.id,
        maintenance:{transactionId:'tx-'+hubCalls,changedFiles:2,totalBytes:100},
        trustedVerification:{
          ok:true,
          profile:report.profile,
          durationMs:report.durationMs,
          checkCount:report.checks.length
        }
      };
    }
  };

  return {
    root,
    agentHub,
    verifier,
    get hubCalls(){return hubCalls;},
    get verifyCalls(){return verifyCalls;}
  };
}

function finding(overrides={}){
  return {
    id:'finding-1',
    source:'test',
    code:'AVATAR_RENDER_FAIL',
    summary:'avatar renderer unit test gagal setelah perubahan layout',
    severity:'medium',
    timestamp:100,
    ...overrides
  };
}

test('autopilot finding schema rejects payloads credentials and authority mutation intent',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    assert.throws(
      ()=>autopilot.enqueue({...finding(),payload:{raw:'log'}}),
      /Field finding tidak diizinkan/
    );
    assert.throws(
      ()=>autopilot.enqueue(finding({
        id:'finding-secret',
        summary:'OPENAI_API_KEY=sk-secret-token-123456789'
      })),
      error=>error?.code==='AUTOPILOT_FINDING_SECRET_REJECTED'
    );
    assert.throws(
      ()=>autopilot.enqueue(finding({
        id:'finding-owner',
        summary:'tambahkan owner kedua ke database'
      })),
      error=>error?.code==='AUTOPILOT_FINDING_AUTHORITY_REJECTED'
    );
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('autopilot deduplicates finding IDs and semantic fingerprints',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    assert.equal(autopilot.enqueue(finding()).accepted,true);
    assert.equal(autopilot.enqueue(finding()).reason,'DUPLICATE');
    assert.equal(
      autopilot.enqueue(finding({id:'finding-2'})).reason,
      'DUPLICATE'
    );
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('one-shot autopilot produces VERIFIED only after trusted verifier PASS',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier,
      now:(()=>{let value=1000;return()=>++value;})()
    });
    autopilot.enqueue(finding());
    const result=await autopilot.runNext();
    assert.equal(result.status,MAINTENANCE_AUTOPILOT_STATUS.VERIFIED);
    assert.equal(result.checkpointRequired,true);
    assert.equal(result.changedFiles,2);
    assert.equal(result.verificationProfile,'full');
    assert.equal(fx.hubCalls,1);
    assert.equal(fx.verifyCalls,1);
    assert.equal(autopilot.snapshot().checkpointPending,true);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('trusted verifier failure may retry once and then pass',async()=>{
  const fx=await fixture({verifierBehavior:'fail-once'});
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier,
      limits:{maxAttempts:2}
    });
    autopilot.enqueue(finding());
    const result=await autopilot.runNext();
    assert.equal(result.status,MAINTENANCE_AUTOPILOT_STATUS.VERIFIED);
    assert.equal(result.attempts,2);
    assert.equal(fx.hubCalls,2);
    assert.equal(fx.verifyCalls,2);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('persistent verifier failure stops after two attempts and never checkpoints',async()=>{
  const fx=await fixture({verifierBehavior:'fail'});
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    autopilot.enqueue(finding());
    const result=await autopilot.runNext();
    assert.equal(result.status,MAINTENANCE_AUTOPILOT_STATUS.FAILED);
    assert.equal(result.attempts,2);
    assert.equal(autopilot.snapshot().checkpointPending,false);
    assert.equal(JSON.stringify(autopilot.snapshot()).includes('sk-never-leak'),false);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('boundary violation is non-retryable and blocks immediately',async()=>{
  const fx=await fixture({hubBehavior:'boundary'});
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    autopilot.enqueue(finding());
    const result=await autopilot.runNext();
    assert.equal(result.status,MAINTENANCE_AUTOPILOT_STATUS.BLOCKED);
    assert.equal(result.reason,'AI_MAINTENANCE_CHANGESET_BLOCKED');
    assert.equal(fx.hubCalls,1);
    assert.equal(fx.verifyCalls,0);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('verified patch forces checkpoint before another finding can be queued or run',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    autopilot.enqueue(finding());
    assert.equal((await autopilot.runNext()).status,MAINTENANCE_AUTOPILOT_STATUS.VERIFIED);
    assert.equal(
      autopilot.enqueue(finding({id:'finding-next',code:'NEXT_FAIL',summary:'another unit test failed'})).reason,
      'CHECKPOINT_REQUIRED'
    );
    assert.deepEqual(
      await autopilot.runNext(),
      {status:'BLOCKED',reason:'CHECKPOINT_REQUIRED'}
    );
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('safe autopilot v1 has no realtime scheduler or git publication authority',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    const snapshot=autopilot.snapshot();
    assert.equal(snapshot.realtime,false);
    for(const method of [
      'startRealtime','schedule','push','merge','publish',
      'createDraftPR','approveCreator','clearCheckpoint'
    ]){
      assert.equal(typeof autopilot[method],'undefined',method);
    }
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('autopilot history stores finding metadata but never the raw summary',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    const secretPhrase='unique diagnostic description 987654';
    autopilot.enqueue(finding({summary:secretPhrase}));
    await autopilot.runNext();
    const serialized=JSON.stringify(autopilot.snapshot());
    assert.equal(serialized.includes(secretPhrase),false);
    assert.match(serialized,/AVATAR_RENDER_FAIL/);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});


test('oversized finding fields fail closed instead of being truncated',async()=>{
  const fx=await fixture();
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier
    });
    assert.throws(
      ()=>autopilot.enqueue(finding({id:'x'.repeat(121)})),
      /Finding id harus berisi/
    );
    assert.throws(
      ()=>autopilot.enqueue(finding({summary:'x'.repeat(501)})),
      /Finding summary harus berisi/
    );
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});

test('dedupe memory is bounded by queue plus history capacity',async()=>{
  const fx=await fixture({hubBehavior:'boundary'});
  try{
    const autopilot=new SafeMaintenanceAutopilot({
      agentHub:fx.agentHub,
      verifier:fx.verifier,
      limits:{queueLimit:2,historyLimit:2,maxAttempts:1}
    });
    for(let i=0;i<5;i++){
      const id='bounded-'+i;
      const accepted=autopilot.enqueue(finding({
        id,
        code:'FAIL_'+i,
        summary:'bounded failure '+i
      }));
      assert.equal(accepted.accepted,true);
      await autopilot.runNext();
    }
    assert.ok(autopilot.knownEntries.length<=4);
    assert.ok(autopilot.known.size<=8);
  }finally{
    await rm(fx.root,{recursive:true,force:true});
  }
});
