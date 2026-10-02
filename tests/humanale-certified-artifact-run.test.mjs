import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMANALE_ARTIFACT_REPOSITORY,
  certifiedArtifactRequest,
  evaluateCertifiedArtifactRun,
  resolveCertifiedArtifactRun
} from '../scripts/humanale-certified-artifact-run.mjs';

const commit='a'.repeat(40),runId=1234;
function fixture(platform='windows'){
  const certificate={build:{commit},artifacts:{
    windowsInstaller:{runId,sourceCommit:commit},
    windowsPortable:{runId,sourceCommit:commit},
    androidApk:{runId:5678,sourceCommit:commit}
  }};
  const request=certifiedArtifactRequest({certificate,platform});
  const run={
    id:request.runId,head_sha:commit,head_branch:'main',event:'workflow_dispatch',
    status:'completed',conclusion:'success',path:request.workflowPath,
    repository:{full_name:HUMANALE_ARTIFACT_REPOSITORY},head_repository:{full_name:HUMANALE_ARTIFACT_REPOSITORY}
  };
  const artifacts=[{id:4321,name:request.artifactName,expired:false,size_in_bytes:1024,workflow_run:{id:request.runId,head_sha:commit}}];
  return {certificate,platform,run,artifacts};
}

test('certified Windows and Android artifacts reuse their successful canonical build runs',()=>{
  for(const platform of ['windows','android']){
    const result=evaluateCertifiedArtifactRun(fixture(platform));
    assert.equal(result.ok,true);
    assert.equal(result.runId,platform==='windows'?1234:5678);
    assert.equal(result.artifactName,(platform==='windows'?'HumanALE-Windows-':'HumanALE-Android-Signed-')+commit);
  }
});

test('certificate must identify one valid source/run for every platform artifact',()=>{
  const cases=[
    certificate=>delete certificate.artifacts.windowsPortable,
    certificate=>certificate.artifacts.windowsPortable.runId++,
    certificate=>certificate.artifacts.windowsInstaller.runId=0,
    certificate=>certificate.artifacts.windowsInstaller.runId='1234',
    certificate=>certificate.artifacts.windowsInstaller.runId=Number.MAX_SAFE_INTEGER+1,
    certificate=>certificate.artifacts.windowsPortable.sourceCommit='b'.repeat(40),
    certificate=>certificate.build.commit='unknown'
  ];
  for(const change of cases){
    const input=fixture();change(input.certificate);
    assert.equal(evaluateCertifiedArtifactRun(input).ok,false);
  }
  assert.equal(certifiedArtifactRequest({certificate:fixture().certificate,platform:'other'}).ok,false);
});

test('failed, unfinished, foreign, wrong-source or wrong-workflow GitHub runs are rejected',()=>{
  const cases=[
    run=>run.id++,run=>run.head_sha='b'.repeat(40),run=>run.head_branch='feature',
    run=>run.event='push',run=>run.path='.github/workflows/android-apk.yml',
    run=>run.status='in_progress',run=>run.conclusion='failure',
    run=>run.repository.full_name='Someone/entitashuman',
    run=>run.head_repository.full_name='Someone/entitashuman'
  ];
  for(const change of cases){
    const input=fixture();change(input.run);
    assert.equal(evaluateCertifiedArtifactRun(input).ok,false);
  }
});

test('missing, expired, ambiguous or differently sourced Actions artifacts are rejected',()=>{
  const cases=[
    input=>input.artifacts=[],input=>input.artifacts.push({...input.artifacts[0]}),
    input=>input.artifacts[0].name='HumanALE-Windows-'+'b'.repeat(40),
    input=>input.artifacts[0].expired=true,input=>delete input.artifacts[0].expired,
    input=>input.artifacts[0].size_in_bytes=0,input=>input.artifacts[0].id=0,
    input=>input.artifacts[0].workflow_run.id++,
    input=>input.artifacts[0].workflow_run.head_sha='b'.repeat(40)
  ];
  for(const change of cases){
    const input=fixture();change(input);
    assert.equal(evaluateCertifiedArtifactRun(input).ok,false);
  }
});

test('resolver requests only canonical Actions metadata and supports artifact pagination',async()=>{
  const input=fixture(),calls=[];
  const result=await resolveCertifiedArtifactRun({...input,requestJson:async path=>{
    calls.push(path);
    if(!path.includes('/artifacts?'))return input.run;
    if(path.endsWith('page=1'))return {total_count:101,artifacts:Array.from({length:100},(_,index)=>({name:'unrelated-'+index}))};
    return {total_count:101,artifacts:input.artifacts};
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(calls,[
    '/repos/Kmpsnr26/entitashuman/actions/runs/1234',
    '/repos/Kmpsnr26/entitashuman/actions/runs/1234/artifacts?per_page=100&page=1',
    '/repos/Kmpsnr26/entitashuman/actions/runs/1234/artifacts?per_page=100&page=2'
  ]);
});

test('invalid certificates cause no metadata calls and malformed inventories fail closed',async()=>{
  const input=fixture();input.certificate.artifacts.windowsPortable.runId=9999;
  assert.equal((await resolveCertifiedArtifactRun({...input,requestJson:()=>assert.fail('invalid certificate queried GitHub')})).ok,false);
  for(const response of [{total_count:1,artifacts:[]},{total_count:1},{total_count:'1',artifacts:[]}]){
    const valid=fixture();
    await assert.rejects(resolveCertifiedArtifactRun({...valid,requestJson:async path=>path.includes('/artifacts?')?response:valid.run}),/inventory/);
  }
});
