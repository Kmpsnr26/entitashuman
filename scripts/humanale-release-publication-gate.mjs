import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const HUMANALE_PUBLICATION_GATES=Object.freeze([
  'runtime-core',
  'visual-avatar',
  'voice-sensors',
  'live-studio',
  'performance-stability',
  'desktop-runtime',
  'android-runtime',
  'release-security',
  'integration-boundary'
]);

const HEX40=/^[0-9a-f]{40}$/i;
const HEX64=/^[0-9a-f]{64}$/i;
const artifactNames=version=>({
  windowsInstaller:`HumanALE-God-Engine-Setup-${version}-x64.exe`,
  windowsPortable:`HumanALE-God-Engine-Portable-${version}-x64.zip`,
  androidApk:`HumanALE-Android-${version}.apk`
});

export function evaluateHumanALEReleasePublicationGate({
  certificate,
  packageVersion,
  githubRefName=''
}={}){
  const errors=[];
  const cert=certificate&&typeof certificate==='object'?certificate:{};

  if(cert.protocol!=='humanale-final-readiness/1'){
    errors.push('readiness protocol must be humanale-final-readiness/1');
  }
  if(cert.finalState!=='FINAL_READY'){
    errors.push('readiness finalState must be FINAL_READY');
  }
  if(cert.integrationUnlocked!==true){
    errors.push('readiness integrationUnlocked must be true');
  }
  if(cert.creatorApproval?.approved!==true){
    errors.push('Creator Final Approval must be explicitly approved');
  }
  if(!cert.creatorApproval?.by||!cert.creatorApproval?.timestamp){
    errors.push('Creator Final Approval metadata is incomplete');
  }

  if(String(cert.build?.version||'')!==String(packageVersion||'')){
    errors.push('readiness build.version must match package.json version');
  }
  if(cert.build?.branch!=='main'){
    errors.push('readiness build.branch must be main');
  }
  if(!HEX40.test(String(cert.build?.commit||''))){
    errors.push('readiness build.commit must be a full 40-character Git SHA');
  }
  for(const [id,fileName] of Object.entries(artifactNames(packageVersion))){
    const artifact=cert.artifacts?.[id];
    if(!artifact||artifact.fileName!==fileName||!HEX64.test(String(artifact.sha256||''))||
        !Number.isSafeInteger(artifact.size)||artifact.size<=0||!Number.isSafeInteger(artifact.runId)||artifact.runId<=0||
        artifact.sourceCommit!==cert.build?.commit){
      errors.push('missing or invalid certified artifact identity: '+id);
    }
  }
  if(githubRefName&&githubRefName!=='main'){
    errors.push('release publication must run from main');
  }

  const gates=Array.isArray(cert.gates)?cert.gates:[];
  const byId=new Map();
  for(const gate of gates){
    if(gate&&typeof gate.id==='string'&&!byId.has(gate.id))byId.set(gate.id,gate);
  }
  for(const id of HUMANALE_PUBLICATION_GATES){
    const gate=byId.get(id);
    if(!gate){
      errors.push('missing required readiness gate: '+id);
      continue;
    }
    if(gate.required!==true){
      errors.push('readiness gate must remain required: '+id);
    }
    if(gate.status!=='pass'){
      errors.push('readiness gate is not PASS: '+id);
    }
    if(!Number(gate.timestamp)){
      errors.push('readiness gate timestamp missing: '+id);
    }
  }

  const summary=cert.summary||{};
  if(summary.required!==HUMANALE_PUBLICATION_GATES.length){
    errors.push('readiness summary.required must equal '+HUMANALE_PUBLICATION_GATES.length);
  }
  if(summary.pass!==HUMANALE_PUBLICATION_GATES.length){
    errors.push('readiness summary.pass must equal '+HUMANALE_PUBLICATION_GATES.length);
  }
  if(Number(summary.fail)!==0||Number(summary.blocked)!==0||Number(summary.pending)!==0){
    errors.push('readiness summary must have zero fail/blocked/pending gates');
  }

  return Object.freeze({
    ok:errors.length===0,
    errors:Object.freeze(errors)
  });
}

// The certificate is committed after the tested build, so permit only the
// certificate and its status note to differ. An arbitrary ancestor is unsafe:
// it can certify runtime changes that have never received device acceptance.
export function certificateSourceMatchesPublication(certificateCommit,githubSha,{repoRoot}={}){
  if(!HEX40.test(String(certificateCommit||''))||!HEX40.test(String(githubSha||'')))return false;
  const options={cwd:repoRoot,encoding:'utf8'};
  const result=spawnSync('git',['merge-base','--is-ancestor',certificateCommit,githubSha],{
    ...options,
    stdio:'ignore'
  });
  if(result.status!==0)return false;
  const diff=spawnSync('git',['diff','--name-only','-z',certificateCommit,githubSha],options);
  if(diff.status!==0)return false;
  const metadataPaths=new Set([
    'docs/humanale-final-readiness-certificate.json',
    'docs/humanale-final-readiness-status.md'
  ]);
  return diff.stdout.split('\0').filter(Boolean).every(file=>metadataPaths.has(file));
}

export async function verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform}={}){
  const ids=platform==='windows'?['windowsInstaller','windowsPortable']:platform==='android'?['androidApk']:[];
  if(ids.length===0)return {ok:false,errors:['artifact platform must be windows or android']};
  const errors=[];
  const names=artifactNames(certificate?.build?.version);
  for(const id of ids){
    const expected=certificate?.artifacts?.[id];
    if(!expected||expected.fileName!==names[id]||!HEX64.test(String(expected.sha256||''))||
        !Number.isSafeInteger(expected.size)||expected.size<=0||expected.sourceCommit!==certificate?.build?.commit){
      errors.push('missing or invalid certified artifact identity: '+id);
      continue;
    }
    const file=resolve(artifactDirectory,expected.fileName);
    try{
      const info=await stat(file);
      if(!info.isFile()||info.size!==expected.size){errors.push('certified artifact size mismatch: '+id);continue;}
      const hash=createHash('sha256');
      for await(const chunk of createReadStream(file))hash.update(chunk);
      if(hash.digest('hex')!==expected.sha256.toLowerCase())errors.push('certified artifact SHA-256 mismatch: '+id);
    }catch{errors.push('certified artifact unavailable: '+id);}
  }
  return {ok:errors.length===0,errors};
}

async function main(){
  const root=new URL('../',import.meta.url);
  const [certificateRaw,packageRaw]=await Promise.all([
    readFile(new URL('docs/humanale-final-readiness-certificate.json',root),'utf8'),
    readFile(new URL('package.json',root),'utf8')
  ]);
  const certificate=JSON.parse(certificateRaw);
  const pkg=JSON.parse(packageRaw);
  const result=evaluateHumanALEReleasePublicationGate({
    certificate,
    packageVersion:pkg.version,
    githubRefName:process.env.GITHUB_REF_NAME||''
  });
  const errors=[...result.errors];

  const repoRoot=fileURLToPath(root);
  const currentHead=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  const githubSha=String(process.env.GITHUB_SHA||currentHead.stdout?.trim()||'');
  if(!certificateSourceMatchesPublication(certificate?.build?.commit,githubSha,{repoRoot})){
    errors.push('publication source differs from the certified build (only certificate/status metadata may change)');
  }
  const artifactFlag=process.argv.indexOf('--artifacts');
  if(artifactFlag!==-1){
    const platformFlag=process.argv.indexOf('--platform');
    const artifactDirectory=process.argv[artifactFlag+1];
    const platform=platformFlag===-1?'':process.argv[platformFlag+1];
    if(!artifactDirectory||artifactDirectory.startsWith('--')){
      errors.push('artifact directory is required');
    }else{
      const artifactResult=await verifyHumanALEPublicationArtifacts({certificate,artifactDirectory,platform});
      errors.push(...artifactResult.errors);
    }
  }

  if(errors.length){
    console.error('HumanALE release publication gate: BLOCKED');
    for(const error of errors)console.error('- '+error);
    process.exitCode=2;
    return;
  }

  console.log('HumanALE release publication gate: PASS');
  console.log('version='+pkg.version);
  console.log('certificateCommit='+certificate.build.commit);
  console.log('publicationCommit='+(githubSha||'local'));
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked){
  main().catch(error=>{
    console.error('HumanALE release publication gate: ERROR');
    console.error(String(error?.message||error));
    process.exitCode=2;
  });
}
