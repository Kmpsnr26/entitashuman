import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  HUMANALE_PUBLICATION_GATES,
  certificateSourceMatchesPublication,
  verifyHumanALEPublicationArtifacts,
  evaluateHumanALEReleasePublicationGate
} from '../scripts/humanale-release-publication-gate.mjs';

const commit='a'.repeat(40);
const readyCertificate=()=>({
  protocol:'humanale-final-readiness/1',
  finalState:'FINAL_READY',
  integrationUnlocked:true,
  build:{version:'2.5.0',commit,branch:'main'},
  creatorApproval:{approved:true,by:'CREATOR',timestamp:10},
  artifacts:Object.fromEntries(Object.entries({
    windowsInstaller:'HumanALE-God-Engine-Setup-2.5.0-x64.exe',
    windowsPortable:'HumanALE-God-Engine-Portable-2.5.0-x64.zip',
    androidApk:'HumanALE-Android-2.5.0.apk'
  }).map(([id,fileName])=>[id,{fileName,sha256:'a'.repeat(64),size:12,sourceCommit:commit,runId:id==='androidApk'?987:543}])),
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

test('publication permits a certificate-only commit but rejects changed runtime even from a valid ancestor',t=>{
  const repoRoot=mkdtempSync(join(tmpdir(),'humanale-publication-'));
  t.after(()=>rmSync(repoRoot,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--quiet');
  git('config','user.name','Test');
  git('config','user.email','test@example.invalid');
  git('config','commit.gpgsign','false');
  mkdirSync(join(repoRoot,'docs'));
  writeFileSync(join(repoRoot,'runtime.js'),'export const version=1;\n');
  git('add','.');
  git('commit','--quiet','-m','tested source');
  const tested=git('rev-parse','HEAD');
  assert.equal(certificateSourceMatchesPublication(tested,tested,{repoRoot}),true);
  writeFileSync(join(repoRoot,'docs','humanale-final-readiness-certificate.json'),JSON.stringify({build:{commit:tested}}));
  writeFileSync(join(repoRoot,'docs','humanale-final-readiness-status.md'),'Certified build.\n');
  git('add','.');
  git('commit','--quiet','-m','record reviewed certificate');
  const certified=git('rev-parse','HEAD');
  assert.equal(certificateSourceMatchesPublication(tested,certified,{repoRoot}),true);
  writeFileSync(join(repoRoot,'runtime.js'),'export const version=2;\n');
  git('add','.');
  git('commit','--quiet','-m','untested runtime change');
  const changed=git('rev-parse','HEAD');
  assert.equal(certificateSourceMatchesPublication(tested,changed,{repoRoot}),false);
  assert.equal(certificateSourceMatchesPublication(changed,tested,{repoRoot}),false);
  assert.equal(certificateSourceMatchesPublication('unknown',changed,{repoRoot}),false);
  assert.equal(certificateSourceMatchesPublication('f'.repeat(40),changed,{repoRoot}),false);
});

test('publication rejects missing artifact hashes or artifact source from another candidate',()=>{
  for(const change of [artifact=>delete artifact.sha256,artifact=>artifact.sourceCommit='b'.repeat(40)]){
    const certificate=readyCertificate();
    change(certificate.artifacts.androidApk);
    const result=evaluateHumanALEReleasePublicationGate({certificate,packageVersion:'2.5.0',githubRefName:'main'});
    assert.equal(result.ok,false);
    assert.ok(result.errors.includes('missing or invalid certified artifact identity: androidApk'));
  }
});

test('downloaded publication artifacts must match the exact tested bytes, not just their source',async t=>{
  const artifactDirectory=mkdtempSync(join(tmpdir(),'humanale-release-bytes-'));
  t.after(()=>rmSync(artifactDirectory,{recursive:true,force:true}));
  const certificate=readyCertificate();
  for(const artifact of Object.values(certificate.artifacts)){
    const bytes=Buffer.from('trusted build bytes');
    artifact.size=bytes.length;
    artifact.sha256=createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(artifactDirectory,artifact.fileName),bytes);
  }
  for(const platform of ['windows','android']){
    assert.equal((await verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform})).ok,true);
  }
  const apk=certificate.artifacts.androidApk;
  writeFileSync(join(artifactDirectory,apk.fileName),'changed build bytes');
  const changed=await verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform:'android'});
  assert.equal(changed.ok,false);
  assert.match(changed.errors.join(' '),/SHA-256 mismatch/);
  rmSync(join(artifactDirectory,apk.fileName));
  assert.equal((await verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform:'android'})).ok,false);
  apk.fileName='../other.apk';
  assert.equal((await verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform:'android'})).ok,false);
});
