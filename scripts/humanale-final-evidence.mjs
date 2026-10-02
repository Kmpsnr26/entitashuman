import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  evaluateHumanALEFinalReadiness
} from '../public/humanale-final-readiness.js';

export const HUMANALE_FINAL_EVIDENCE_AGGREGATOR_VERSION=1;

const TARGETS=Object.freeze({
  performance:{
    gate:'performance-stability',
    protocol:'humanale-performance-stability/1',
    passState:'PERFORMANCE_STABILITY_PASS',
    source:'operator-windows-performance-stability'
  },
  android:{
    gate:'android-runtime',
    protocol:'humanale-android-runtime/1',
    passState:'ANDROID_RUNTIME_PASS',
    source:'operator-android-runtime'
  },
  security:{
    gate:'release-security',
    protocol:'humanale-release-security/1',
    passState:'RELEASE_SECURITY_PASS',
    source:'release-security-validator'
  }
});

const bounded=(value,max=240)=>String(value??'').trim().slice(0,max);

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function gateMapFromCertificate(certificate={}){
  const checks={};
  for(const gate of certificate.gates||[]){
    if(!gate?.id)continue;
    checks[gate.id]={
      status:gate.status,
      required:gate.required!==false,
      source:gate.source||'certificate',
      note:gate.note||'',
      timestamp:Number(gate.timestamp)||0
    };
  }
  return checks;
}

function validateIdentity(result,{expectedBranch,expectedCommit}){
  const reasons=[];
  if(!expectedBranch)reasons.push('expected-branch-missing');
  if(!/^[0-9a-f]{40}$/i.test(String(expectedCommit||'')))reasons.push('expected-candidate-invalid');
  if(expectedBranch&&result?.branch!==expectedBranch){
    reasons.push('branch-mismatch');
  }
  if(expectedCommit&&result?.candidate!==expectedCommit){
    reasons.push('candidate-mismatch');
  }
  return reasons;
}

function evaluatePerformance(result){
  const reasons=[];
  const m=result?.metrics||{};
  if(result?.fullyValidated!==true)reasons.push('fullyValidated=false');
  if(result?.state!==TARGETS.performance.passState)reasons.push('state-not-pass');
  if(m.allProcessesStayedAlive!==true)reasons.push('process-liveness-not-pass');
  if(m.responding!==true)reasons.push('responding-not-pass');
  if(m.operatorStable!==true)reasons.push('operator-stability-not-pass');
  return reasons;
}

function evaluateAndroid(result){
  const reasons=[];
  if(result?.artifactSourceVerified!==true)reasons.push('artifact-source-unverified');
  if(!/^[0-9a-f]{64}$/i.test(String(result?.apkSha256||'')))reasons.push('artifact-hash-invalid');
  if(result?.fullyValidated!==true)reasons.push('fullyValidated=false');
  if(result?.state!==TARGETS.android.passState)reasons.push('state-not-pass');
  if(result?.installSuccess!==true)reasons.push('install-not-pass');
  if(result?.packageDetected!==true)reasons.push('package-not-detected');
  if(result?.launchSuccess!==true)reasons.push('launch-not-pass');
  if(result?.processAlive!==true)reasons.push('process-liveness-not-pass');
  if(result?.foregroundMatches!==true)reasons.push('foreground-not-pass');
  if(result?.operatorPass!==true)reasons.push('operator-device-validation-not-pass');
  return reasons;
}

function evaluateSecurity(result){
  const reasons=[];
  if(result?.artifactSourceVerified!==true)reasons.push('artifact-source-unverified');
  if(result?.android?.productionSignerMatched!==true)reasons.push('production-signer-not-pass');
  if(!/^[0-9a-f]{64}$/i.test(String(result?.windows?.installerSha256||''))||
      !/^[0-9a-f]{64}$/i.test(String(result?.android?.apkSha256||'')))reasons.push('artifact-hash-invalid');
  if(result?.fullyValidated!==true)reasons.push('fullyValidated=false');
  if(result?.state!==TARGETS.security.passState)reasons.push('state-not-pass');
  if(result?.windows?.pass!==true)reasons.push('windows-authenticode-not-pass');
  if(result?.windows?.signatureStatus!=='Valid')reasons.push('windows-signature-invalid');
  if(result?.android?.pass!==true)reasons.push('android-signature-not-pass');
  if(result?.android?.signatureStatus!=='verified')reasons.push('android-signature-unverified');
  return reasons;
}

function technicalCheck(kind,result,identity){
  const target=TARGETS[kind];
  if(!result){
    return {
      status:'pending',
      required:true,
      source:target.source,
      note:'Evidence file is missing; real-device/release validation is still required.',
      timestamp:0
    };
  }

  const reasons=[];
  if(result.protocol!==target.protocol)reasons.push('protocol-mismatch');
  reasons.push(...validateIdentity(result,identity));
  if(kind==='performance')reasons.push(...evaluatePerformance(result));
  if(kind==='android')reasons.push(...evaluateAndroid(result));
  if(kind==='security')reasons.push(...evaluateSecurity(result));

  const timestamp=Number(result.generatedAt)||0;
  if(reasons.length){
    const incompleteOnly=reasons.every(reason=>
      reason==='fullyValidated=false'||
      reason==='state-not-pass'||
      reason.endsWith('-not-pass')||
      reason.endsWith('-not-detected')||
      reason.endsWith('-unverified')||
      reason.endsWith('-invalid')
    );
    return {
      status:incompleteOnly?'pending':'blocked',
      required:true,
      source:target.source,
      note:bounded('Evidence not accepted: '+reasons.join(', '),240),
      timestamp
    };
  }

  return {
    status:'pass',
    required:true,
    source:target.source,
    note:bounded(
      kind==='performance'
        ?'Real Windows stability evidence accepted: process alive/responding and operator confirmed no repeated crash/error/flicker.'
        :kind==='android'
          ?'Signed APK real-device install/launch and operator validation evidence accepted.'
          :'Windows Authenticode and Android apksigner release-security evidence accepted.',
      240
    ),
    timestamp
  };
}

function orderedGates(evaluation){
  return evaluation.gates.map(g=>({
    id:g.id,
    status:g.status,
    required:g.required,
    source:g.source,
    note:g.note,
    timestamp:g.timestamp
  }));
}

export function aggregateHumanALEFinalEvidence({
  certificate,
  performanceResult=null,
  androidResult=null,
  securityResult=null,
  expectedBranch='',
  expectedCommit='',
  generatedAt=Date.now()
}={}){
  if(!certificate||typeof certificate!=='object'){
    throw new TypeError('Existing HumanALE readiness certificate is required.');
  }

  const checks=gateMapFromCertificate(certificate);
  const certificateIdentityReasons=validateIdentity({
    branch:certificate.build?.branch,
    candidate:certificate.build?.commit
  },{expectedBranch,expectedCommit});
  if(certificate.protocol!=='humanale-final-readiness/1'){
    certificateIdentityReasons.push('certificate-protocol-mismatch');
  }
  if(certificateIdentityReasons.length){
    for(const check of Object.values(checks)){
      check.status='blocked';
      check.note=bounded('Existing certificate not accepted: '+certificateIdentityReasons.join(', '));
    }
  }
  checks[TARGETS.performance.gate]=technicalCheck(
    'performance',
    performanceResult,
    {expectedBranch,expectedCommit}
  );
  checks[TARGETS.android.gate]=technicalCheck(
    'android',
    androidResult,
    {expectedBranch,expectedCommit}
  );
  checks[TARGETS.security.gate]=technicalCheck(
    'security',
    securityResult,
    {expectedBranch,expectedCommit}
  );
  if(checks[TARGETS.android.gate].status==='pass'&&checks[TARGETS.security.gate].status==='pass'&&
      androidResult.apkSha256.toLowerCase()!==securityResult.android.apkSha256.toLowerCase()){
    for(const id of [TARGETS.android.gate,TARGETS.security.gate]){
      checks[id].status='blocked';
      checks[id].note='Runtime and release-security evidence refer to different APK hashes.';
    }
  }

  const creatorApproval={
    approved:certificateIdentityReasons.length===0&&certificate?.creatorApproval?.approved===true,
    by:bounded(certificate?.creatorApproval?.by,80),
    note:bounded(certificate?.creatorApproval?.note,240),
    timestamp:Number(certificate?.creatorApproval?.timestamp)||0
  };

  const evidence={
    version:1,
    generatedAt,
    build:{
      version:bounded(certificate?.build?.version||'2.5.0',32),
      commit:bounded(expectedCommit||certificate?.build?.commit,64),
      branch:bounded(expectedBranch||certificate?.build?.branch,96)
    },
    checks,
    creatorApproval
  };

  const evaluated=evaluateHumanALEFinalReadiness(evidence);

  return Object.freeze({
    protocol:evaluated.protocol,
    aggregatorVersion:HUMANALE_FINAL_EVIDENCE_AGGREGATOR_VERSION,
    generatedAt,
    finalState:evaluated.finalState,
    technicalReady:evaluated.technicalReady,
    creatorApproved:evaluated.creatorApproved,
    integrationUnlocked:evaluated.integrationUnlocked,
    build:Object.freeze({...evaluated.build}),
    creatorApproval:Object.freeze({...evaluated.creatorApproval}),
    gates:Object.freeze(orderedGates(evaluated).map(g=>Object.freeze({...g}))),
    summary:Object.freeze({...evaluated.summary}),
    blockers:Object.freeze([...evaluated.blockers]),
    safety:Object.freeze({
      certificateIdentityMatched:certificateIdentityReasons.length===0,
      creatorApprovalInferred:false,
      liveIntegrationActivated:false,
      certificateAutoMerged:false
    })
  });
}

function readJsonIfExists(filePath){
  if(!fs.existsSync(filePath))return null;
  return JSON.parse(fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,''));
}

function gitValue(repoRoot,args){
  try{
    return execFileSync('git',['-C',repoRoot,...args],{encoding:'utf8'}).trim();
  }catch{
    return '';
  }
}

export function runHumanALEFinalEvidenceCli({
  repoRoot,
  outputPath
}={}){
  const root=repoRoot||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const scriptsDir=path.join(root,'scripts');
  const certificatePath=path.join(root,'docs','humanale-final-readiness-certificate.json');
  const out=outputPath||path.join(scriptsDir,'humanale-final-evidence-result.json');

  const certificate=readJsonIfExists(certificatePath);
  if(!certificate)throw new Error('HumanALE readiness certificate not found: '+certificatePath);

  const expectedCommit=gitValue(root,['rev-parse','HEAD']);
  const expectedBranch=gitValue(root,['branch','--show-current']);

  const result=aggregateHumanALEFinalEvidence({
    certificate,
    performanceResult:readJsonIfExists(path.join(scriptsDir,'humanale-performance-stability-result.json')),
    androidResult:readJsonIfExists(path.join(scriptsDir,'humanale-android-runtime-result.json')),
    securityResult:readJsonIfExists(path.join(scriptsDir,'humanale-release-security-result.json')),
    expectedBranch,
    expectedCommit
  });

  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n','utf8');
  return {result,outputPath:out};
}

const invokedDirectly=process.argv[1]&&
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url);

if(invokedDirectly){
  try{
    const {result,outputPath}=runHumanALEFinalEvidenceCli({});
    console.log('HumanALE Final Evidence Aggregator');
    console.log('Technical ready:',result.technicalReady);
    console.log('Final state:',result.finalState);
    console.log('Creator approved:',result.creatorApproved);
    console.log('Output:',outputPath);
    if(result.blockers.length)console.log('Blockers:',result.blockers.join(', '));
    process.exitCode=result.technicalReady?0:2;
  }catch(error){
    console.error(error instanceof Error?error.message:String(error));
    process.exitCode=1;
  }
}
