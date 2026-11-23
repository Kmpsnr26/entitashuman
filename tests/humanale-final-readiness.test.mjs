import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMANALE_FINAL_GATES,
  evaluateHumanALEFinalReadiness,
  assertHumanALEIntegrationUnlocked,
  createHumanALEReadinessCertificate
} from '../public/humanale-final-readiness.js';

const passingChecks=Object.fromEntries(HUMANALE_FINAL_GATES.map(id=>[id,{status:'pass',source:'automated-test',timestamp:1}]));

test('HumanALE final readiness is fail-closed by default',()=>{
  const result=evaluateHumanALEFinalReadiness({});
  assert.equal(result.finalState,'LOCKED');
  assert.equal(result.integrationUnlocked,false);
  assert.equal(result.summary.pending,HUMANALE_FINAL_GATES.length);
  assert.ok(result.blockers.includes('runtime-core:PENDING'));
});

test('technical readiness alone does not unlock AleCore AI integration',()=>{
  const result=evaluateHumanALEFinalReadiness({
    build:{version:'2.5.0',commit:'abc123',branch:'candidate'},
    checks:passingChecks
  });
  assert.equal(result.technicalReady,true);
  assert.equal(result.creatorApproved,false);
  assert.equal(result.integrationUnlocked,false);
  assert.ok(result.blockers.includes('creator-approval:PENDING'));
});

test('explicit creator approval plus all required gates unlocks final integration',()=>{
  const evidence={
    build:{version:'2.5.0',commit:'abc123',branch:'candidate'},
    checks:passingChecks,
    creatorApproval:{approved:true,by:'CREATOR',note:'Approved for final AleCore AI integration.',timestamp:2}
  };
  const result=assertHumanALEIntegrationUnlocked(evidence);
  assert.equal(result.finalState,'FINAL_READY');
  assert.equal(result.integrationUnlocked,true);
  const certificate=createHumanALEReadinessCertificate(evidence);
  assert.equal(certificate.integrationUnlocked,true);
  assert.equal(certificate.gates.length,HUMANALE_FINAL_GATES.length);
});

test('one blocked required gate keeps integration locked',()=>{
  const checks={...passingChecks,'android-runtime':{status:'blocked',source:'device-validation'}};
  const result=evaluateHumanALEFinalReadiness({
    checks,
    creatorApproval:{approved:true,by:'CREATOR'}
  });
  assert.equal(result.technicalReady,false);
  assert.equal(result.integrationUnlocked,false);
  assert.ok(result.blockers.includes('android-runtime:BLOCKED'));
  assert.throws(
    ()=>assertHumanALEIntegrationUnlocked({checks,creatorApproval:{approved:true,by:'CREATOR'}}),
    error=>error?.code==='HUMANALE_INTEGRATION_LOCKED'
  );
});
