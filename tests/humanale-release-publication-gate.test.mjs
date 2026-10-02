import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMANALE_PUBLICATION_GATES,
  evaluateHumanALEReleasePublicationGate
} from '../scripts/humanale-release-publication-gate.mjs';

const commit='a'.repeat(40);
const readyCertificate=()=>({
  protocol:'humanale-final-readiness/1',
  finalState:'FINAL_READY',
  integrationUnlocked:true,
  build:{version:'2.5.0',commit,branch:'main'},
  creatorApproval:{approved:true,by:'CREATOR',timestamp:10},
  gates:HUMANALE_PUBLICATION_GATES.map(id=>({
    id,status:'pass',required:true,source:'test',timestamp:10
  })),
  summary:{total:9,required:9,pass:9,fail:0,blocked:0,pending:0}
});

test('publication gate accepts only a fully ready main certificate',()=>{
  const result=evaluateHumanALEReleasePublicationGate({
    certificate:readyCertificate(),
    packageVersion:'2.5.0',
    githubRefName:'main'
  });
  assert.equal(result.ok,true);
  assert.deepEqual(result.errors,[]);
});

test('publication gate blocks LOCKED readiness and missing creator approval',()=>{
  const certificate=readyCertificate();
  certificate.finalState='LOCKED';
  certificate.integrationUnlocked=false;
  certificate.creatorApproval={approved:false,by:'',timestamp:0};
  const result=evaluateHumanALEReleasePublicationGate({
    certificate,
    packageVersion:'2.5.0',
    githubRefName:'main'
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>/FINAL_READY/.test(error)));
  assert.ok(result.errors.some(error=>/Creator Final Approval/.test(error)));
});

test('publication gate blocks any pending required gate even when summary is forged green',()=>{
  const certificate=readyCertificate();
  certificate.gates=certificate.gates.map(gate=>
    gate.id==='android-runtime'?{...gate,status:'pending'}:gate
  );
  const result=evaluateHumanALEReleasePublicationGate({
    certificate,
    packageVersion:'2.5.0',
    githubRefName:'main'
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('readiness gate is not PASS: android-runtime'));
});

test('publication gate blocks release-candidate branch and version mismatch',()=>{
  const certificate=readyCertificate();
  certificate.build.branch='codex/release-2.5.0-final-candidate';
  const result=evaluateHumanALEReleasePublicationGate({
    certificate,
    packageVersion:'2.5.1',
    githubRefName:'codex/release-2.5.0-final-candidate'
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>/build\.version/.test(error)));
  assert.ok(result.errors.some(error=>/build\.branch must be main/.test(error)));
  assert.ok(result.errors.some(error=>/must run from main/.test(error)));
});

test('publication gate requires all nine named gates with evidence timestamps',()=>{
  const certificate=readyCertificate();
  certificate.gates=certificate.gates.filter(gate=>gate.id!=='release-security');
  const result=evaluateHumanALEReleasePublicationGate({
    certificate,
    packageVersion:'2.5.0',
    githubRefName:'main'
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('missing required readiness gate: release-security'));
});
