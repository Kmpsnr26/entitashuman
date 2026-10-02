import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateHumanALEFinalEvidence
} from '../scripts/humanale-final-evidence.mjs';

const branch='codex/release-2.5.0-final-candidate';
const commit='abcdef123456';

function baseCertificate({approved=false}={}){
  const ids=[
    'runtime-core','visual-avatar','voice-sensors','live-studio',
    'performance-stability','desktop-runtime','android-runtime',
    'release-security','integration-boundary'
  ];
  const passed=new Set([
    'runtime-core','visual-avatar','voice-sensors','live-studio',
    'desktop-runtime','integration-boundary'
  ]);
  return {
    protocol:'humanale-final-readiness/1',
    finalState:'LOCKED',
    integrationUnlocked:false,
    build:{version:'2.5.0',commit:'old',branch},
    creatorApproval:{
      approved,
      by:approved?'CREATOR':'',
      note:approved?'Explicit creator approval.':'Pending creator approval.',
      timestamp:approved?50:0
    },
    gates:ids.map(id=>({
      id,
      status:passed.has(id)?'pass':'pending',
      required:true,
      source:'existing-certificate',
      note:'',
      timestamp:passed.has(id)?1:0
    }))
  };
}

function performanceResult(){
  return {
    protocol:'humanale-performance-stability/1',
    candidate:commit,
    branch,
    generatedAt:100,
    state:'PERFORMANCE_STABILITY_PASS',
    fullyValidated:true,
    metrics:{
      allProcessesStayedAlive:true,
      responding:true,
      operatorStable:true
    }
  };
}

function androidResult(){
  return {
    protocol:'humanale-android-runtime/1',
    candidate:commit,
    branch,
    generatedAt:110,
    state:'ANDROID_RUNTIME_PASS',
    fullyValidated:true,
    installSuccess:true,
    packageDetected:true,
    operatorPass:true
  };
}

function securityResult(){
  return {
    protocol:'humanale-release-security/1',
    candidate:commit,
    branch,
    generatedAt:120,
    state:'RELEASE_SECURITY_PASS',
    fullyValidated:true,
    windows:{pass:true,signatureStatus:'Valid'},
    android:{pass:true,signatureStatus:'verified'}
  };
}

test('valid technical evidence closes 9/9 gates but never infers creator approval',()=>{
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:performanceResult(),
    androidResult:androidResult(),
    securityResult:securityResult(),
    expectedBranch:branch,
    expectedCommit:commit,
    generatedAt:200
  });
  assert.equal(result.technicalReady,true);
  assert.equal(result.summary.pass,9);
  assert.equal(result.summary.pending,0);
  assert.equal(result.creatorApproved,false);
  assert.equal(result.integrationUnlocked,false);
  assert.equal(result.finalState,'LOCKED');
  assert.deepEqual(result.blockers,['creator-approval:PENDING']);
  assert.equal(result.safety.creatorApprovalInferred,false);
  assert.equal(result.safety.liveIntegrationActivated,false);
});

test('explicit creator approval in existing certificate is preserved, never synthesized',()=>{
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate({approved:true}),
    performanceResult:performanceResult(),
    androidResult:androidResult(),
    securityResult:securityResult(),
    expectedBranch:branch,
    expectedCommit:commit
  });
  assert.equal(result.technicalReady,true);
  assert.equal(result.creatorApproved,true);
  assert.equal(result.integrationUnlocked,true);
  assert.equal(result.finalState,'FINAL_READY');
  assert.equal(result.creatorApproval.by,'CREATOR');
});

test('missing evidence remains pending and cannot become technically ready',()=>{
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    expectedBranch:branch,
    expectedCommit:commit
  });
  assert.equal(result.technicalReady,false);
  assert.equal(result.summary.pass,6);
  assert.equal(result.summary.pending,3);
  assert.ok(result.blockers.includes('performance-stability:PENDING'));
  assert.ok(result.blockers.includes('android-runtime:PENDING'));
  assert.ok(result.blockers.includes('release-security:PENDING'));
});

test('candidate or branch mismatch is fail-closed as BLOCKED evidence',()=>{
  const perf=performanceResult();
  perf.candidate='wrong-commit';
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:perf,
    androidResult:androidResult(),
    securityResult:securityResult(),
    expectedBranch:branch,
    expectedCommit:commit
  });
  const gate=result.gates.find(g=>g.id==='performance-stability');
  assert.equal(gate.status,'blocked');
  assert.match(gate.note,/candidate-mismatch/);
  assert.equal(result.technicalReady,false);
});

test('performance PASS label is rejected unless liveness/responding/operator stability all pass',()=>{
  const perf=performanceResult();
  perf.metrics.operatorStable=false;
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:perf,
    androidResult:androidResult(),
    securityResult:securityResult(),
    expectedBranch:branch,
    expectedCommit:commit
  });
  const gate=result.gates.find(g=>g.id==='performance-stability');
  assert.equal(gate.status,'pending');
  assert.match(gate.note,/operator-stability-not-pass/);
  assert.equal(result.technicalReady,false);
});

test('Android evidence requires real-device install, package detection and operator validation',()=>{
  const android=androidResult();
  android.operatorPass=false;
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:performanceResult(),
    androidResult:android,
    securityResult:securityResult(),
    expectedBranch:branch,
    expectedCommit:commit
  });
  const gate=result.gates.find(g=>g.id==='android-runtime');
  assert.equal(gate.status,'pending');
  assert.match(gate.note,/operator-device-validation-not-pass/);
});

test('release security requires both Authenticode and Android signature verification',()=>{
  const security=securityResult();
  security.windows.signatureStatus='NotSigned';
  security.windows.pass=false;
  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:performanceResult(),
    androidResult:androidResult(),
    securityResult:security,
    expectedBranch:branch,
    expectedCommit:commit
  });
  const gate=result.gates.find(g=>g.id==='release-security');
  assert.equal(gate.status,'pending');
  assert.match(gate.note,/windows-authenticode-not-pass/);
  assert.equal(result.technicalReady,false);
});

test('technical result files cannot inject creator approval',()=>{
  const perf=performanceResult();
  perf.creatorApproval={approved:true,by:'FORGED'};
  const android=androidResult();
  android.creatorApproval={approved:true,by:'FORGED'};
  const security=securityResult();
  security.creatorApproval={approved:true,by:'FORGED'};

  const result=aggregateHumanALEFinalEvidence({
    certificate:baseCertificate(),
    performanceResult:perf,
    androidResult:android,
    securityResult:security,
    expectedBranch:branch,
    expectedCommit:commit
  });
  assert.equal(result.creatorApproved,false);
  assert.equal(result.integrationUnlocked,false);
});
