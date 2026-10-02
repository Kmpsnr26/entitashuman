import {appendFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const HUMANALE_ARTIFACT_REPOSITORY='Kmpsnr26/entitashuman';
const platforms=Object.freeze({
  windows:{ids:['windowsInstaller','windowsPortable'],workflow:'.github/workflows/verify.yml',prefix:'HumanALE-Windows-'},
  android:{ids:['androidApk'],workflow:'.github/workflows/android-apk.yml',prefix:'HumanALE-Android-Signed-'}
});
const positiveId=value=>Number.isSafeInteger(value)&&value>0;

export function certifiedArtifactRequest({certificate,platform}={}){
  const errors=[];
  const config=platforms[platform];
  if(!config)return {ok:false,errors:['artifact platform must be windows or android']};
  const sourceCommit=String(certificate?.build?.commit||'');
  if(!/^[0-9a-f]{40}$/.test(sourceCommit))errors.push('certified source must be a full lowercase Git SHA');
  const artifacts=config.ids.map(id=>certificate?.artifacts?.[id]);
  const runId=artifacts[0]?.runId;
  if(!positiveId(runId))errors.push('certified artifact runId must be a positive safe integer');
  for(let i=0;i<artifacts.length;i++){
    if(!artifacts[i]||artifacts[i].runId!==runId||artifacts[i].sourceCommit!==sourceCommit){
      errors.push('certified artifact run/source mismatch: '+config.ids[i]);
    }
  }
  return {ok:errors.length===0,errors,runId,sourceCommit,workflowPath:config.workflow,artifactName:config.prefix+sourceCommit};
}

export function evaluateCertifiedArtifactRun({certificate,platform,run,artifacts}={}){
  const request=certifiedArtifactRequest({certificate,platform});
  const errors=[...request.errors];
  if(!request.ok)return {...request,errors};
  if(run?.id!==request.runId)errors.push('GitHub run ID does not match the certificate');
  if(run?.repository?.full_name!==HUMANALE_ARTIFACT_REPOSITORY||
      run?.head_repository?.full_name!==HUMANALE_ARTIFACT_REPOSITORY){
    errors.push('GitHub run must belong to the canonical repository');
  }
  if(run?.head_sha!==request.sourceCommit)errors.push('GitHub run source does not match the certified commit');
  if(run?.head_branch!=='main')errors.push('certified artifacts must be built from main');
  if(run?.event!=='workflow_dispatch')errors.push('certified artifacts require a manual build run');
  if(run?.path!==request.workflowPath)errors.push('GitHub run workflow does not match the certified platform');
  if(run?.status!=='completed'||run?.conclusion!=='success')errors.push('certified build run must be completed successfully');
  const matches=(Array.isArray(artifacts)?artifacts:[]).filter(artifact=>artifact?.name===request.artifactName);
  if(matches.length!==1){
    errors.push('expected certified artifact must exist exactly once');
  }else{
    const artifact=matches[0];
    if(!positiveId(artifact.id)||artifact.expired!==false||!positiveId(artifact.size_in_bytes)){
      errors.push('certified artifact must be available and unexpired');
    }
    if(artifact.workflow_run?.id!==request.runId||artifact.workflow_run?.head_sha!==request.sourceCommit){
      errors.push('artifact workflow identity does not match the certified run/source');
    }
  }
  return {...request,ok:errors.length===0,errors};
}

export async function resolveCertifiedArtifactRun({certificate,platform,requestJson}={}){
  const request=certifiedArtifactRequest({certificate,platform});
  if(!request.ok)return request;
  const base='/repos/'+HUMANALE_ARTIFACT_REPOSITORY+'/actions/runs/'+request.runId;
  const run=await requestJson(base);
  const artifacts=[];
  let total=0,page=1;
  do{
    const response=await requestJson(base+'/artifacts?per_page=100&page='+page);
    if(!Number.isSafeInteger(response?.total_count)||response.total_count<0||!Array.isArray(response.artifacts)){
      throw new Error('GitHub artifact inventory is invalid');
    }
    total=response.total_count;
    artifacts.push(...response.artifacts);
    if(artifacts.length<total&&response.artifacts.length===0)throw new Error('GitHub artifact inventory is incomplete');
    page++;
    if(page>101&&artifacts.length<total)throw new Error('GitHub artifact inventory exceeds the supported bound');
  }while(artifacts.length<total);
  return evaluateCertifiedArtifactRun({certificate,platform,run,artifacts});
}

async function main(){
  if(process.env.GITHUB_REPOSITORY!==HUMANALE_ARTIFACT_REPOSITORY)throw new Error('Artifact resolution requires the canonical GitHub repository');
  const token=process.env.GH_TOKEN;
  if(!token)throw new Error('GitHub Actions read token is required');
  if(!process.env.GITHUB_OUTPUT)throw new Error('GITHUB_OUTPUT is required');
  const flag=process.argv.indexOf('--platform');
  const platform=flag===-1?'':process.argv[flag+1];
  const certificate=JSON.parse(await readFile(new URL('../docs/humanale-final-readiness-certificate.json',import.meta.url),'utf8'));
  const requestJson=async apiPath=>{
    const response=await fetch('https://api.github.com'+apiPath,{
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},
      signal:AbortSignal.timeout(30000)
    });
    if(!response.ok)throw new Error('GitHub Actions metadata request failed (HTTP '+response.status+')');
    return response.json();
  };
  const result=await resolveCertifiedArtifactRun({certificate,platform,requestJson});
  if(!result.ok)throw new Error(result.errors.join('; '));
  await appendFile(process.env.GITHUB_OUTPUT,'run-id='+result.runId+'\nartifact-name='+result.artifactName+'\n','utf8');
  console.log('Certified '+platform+' artifact run verified: '+result.runId);
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  main().catch(error=>{console.error('Certified artifact run: BLOCKED - '+String(error?.message||error));process.exitCode=2;});
}
