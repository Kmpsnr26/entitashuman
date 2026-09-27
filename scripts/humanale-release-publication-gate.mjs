import {readFile} from 'node:fs/promises';
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

export function certificateCommitIsAncestor(certificateCommit,githubSha){
  if(!HEX40.test(String(certificateCommit||''))||!HEX40.test(String(githubSha||'')))return false;
  const result=spawnSync('git',['merge-base','--is-ancestor',certificateCommit,githubSha],{
    stdio:'ignore'
  });
  return result.status===0;
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

  const githubSha=String(process.env.GITHUB_SHA||'');
  if(githubSha&&!certificateCommitIsAncestor(certificate?.build?.commit,githubSha)){
    errors.push('readiness build.commit is not an ancestor of GITHUB_SHA');
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
