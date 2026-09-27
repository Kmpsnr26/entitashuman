import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sanitizeMaintenanceEnvironment} from './agent-maintenance-guard.mjs';
import {redactSecrets} from './terminal-policy.mjs';
import {MAINTENANCE_BRANCH_PREFIX} from './maintenance-workspace.mjs';

export const MAINTENANCE_DRAFT_PR_BROKER_VERSION='1.0.0';

const SHA=/^[a-f0-9]{40}$/i;
const SAFE_REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function safeText(value,max){
  const text=String(value??'')
    .replace(/[\r\n\t]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!text||text.length>max)throw new TypeError('Broker text harus berisi 1–'+max+' karakter.');
  if(redactSecrets(text)!==text){
    const error=new Error('Draft PR metadata mengandung secret/credential pattern.');
    error.code='MAINTENANCE_DRAFT_SECRET_REJECTED';
    throw error;
  }
  return text;
}

function parseGithubRemote(value){
  const remote=String(value||'').trim();
  const https=remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if(https)return https[1]+'/'+https[2];
  const ssh=remote.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if(ssh)return ssh[1]+'/'+ssh[2];
  const sshUrl=remote.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if(sshUrl)return sshUrl[1]+'/'+sshUrl[2];
  return null;
}

async function defaultRunner(command,args,{cwd,timeout=120000}={}){
  const env=sanitizeMaintenanceEnvironment(process.env).env;
  return await new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{
      cwd,
      windowsHide:true,
      shell:false,
      stdio:['ignore','pipe','pipe'],
      env
    });
    let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      error?reject(error):resolvePromise(value);
    };
    const timer=setTimeout(()=>{
      child.kill();
      finish(new Error('Trusted publication command timeout.'));
    },timeout);
    child.stdout.on('data',data=>{stdout=(stdout+String(data)).slice(-1024*1024);});
    child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-64000);});
    child.on('error',error=>finish(error));
    child.on('close',code=>{
      const result={code,stdout,stderr};
      if(code===0)return finish(null,result);
      finish(new Error(
        'Trusted publication command gagal: '+
        command+' '+args.join(' ')+'\n'+redactSecrets(stderr).slice(-4000)
      ));
    });
  });
}

function assertReceipt(receipt){
  if(!receipt||receipt.verified!==true){
    const error=new Error('Draft PR broker membutuhkan verified checkpoint receipt.');
    error.code='MAINTENANCE_DRAFT_VERIFY_REQUIRED';
    throw error;
  }
  if(!String(receipt.branchName||'').startsWith(MAINTENANCE_BRANCH_PREFIX)){
    const error=new Error('Draft PR broker hanya boleh mempublikasikan maintenance branch.');
    error.code='MAINTENANCE_DRAFT_BRANCH_DENIED';
    throw error;
  }
  if(!SHA.test(String(receipt.baseHead||''))||!SHA.test(String(receipt.commitSha||''))){
    throw new TypeError('Draft PR receipt SHA tidak valid.');
  }
  if(receipt.baseHead===receipt.commitSha){
    throw new TypeError('Draft PR checkpoint tidak memiliki commit perubahan.');
  }
}

function ghExecutable(){
  return process.platform==='win32'?'gh.exe':'gh';
}

export class TrustedDraftPRBroker{
  constructor({
    expectedRepository,
    runner=defaultRunner,
    remote='origin',
    now=()=>Date.now()
  }={}){
    if(!SAFE_REPO.test(String(expectedRepository||''))){
      throw new TypeError('expectedRepository harus owner/repo GitHub yang valid.');
    }
    if(remote!=='origin'){
      throw new TypeError('Trusted Draft PR Broker v1 hanya mengizinkan remote origin.');
    }
    if(typeof runner!=='function')throw new TypeError('Draft PR broker runner harus function.');
    this.expectedRepository=expectedRepository;
    this.runner=runner;
    this.remote=remote;
    this.now=now;
  }

  async run(command,args,cwd){
    return this.runner(command,args,{cwd});
  }

  async verifyRepository(repoRoot){
    const root=await realpath(resolve(repoRoot));
    const remoteResult=await this.run(
      'git',
      ['remote','get-url',this.remote],
      root
    );
    const actual=parseGithubRemote(remoteResult.stdout);
    if(actual?.toLowerCase()!==this.expectedRepository.toLowerCase()){
      const error=new Error('Origin GitHub repository tidak cocok dengan trusted broker config.');
      error.code='MAINTENANCE_DRAFT_REMOTE_MISMATCH';
      throw error;
    }
    return root;
  }

  async verifyLocalCheckpoint(root,receipt){
    const branchHead=(await this.run(
      'git',
      ['rev-parse','refs/heads/'+receipt.branchName],
      root
    )).stdout.trim();
    if(branchHead!==receipt.commitSha){
      const error=new Error('Local maintenance branch HEAD tidak cocok dengan checkpoint receipt.');
      error.code='MAINTENANCE_DRAFT_HEAD_MISMATCH';
      throw error;
    }

    const parent=(await this.run(
      'git',
      ['rev-parse',receipt.commitSha+'^'],
      root
    )).stdout.trim();
    if(parent!==receipt.baseHead){
      const error=new Error('Maintenance checkpoint bukan satu commit di atas base HEAD.');
      error.code='MAINTENANCE_DRAFT_PARENT_MISMATCH';
      throw error;
    }
  }

  async existingDraft(root,receipt){
    const result=await this.run(
      ghExecutable(),
      [
        'pr','list',
        '--repo',this.expectedRepository,
        '--state','open',
        '--head',receipt.branchName,
        '--json','number,url,isDraft,baseRefName,headRefName,headRefOid',
        '--limit','10'
      ],
      root
    );
    let rows;
    try{rows=JSON.parse(result.stdout||'[]');}
    catch{
      throw new Error('Output gh pr list tidak valid JSON.');
    }
    if(!Array.isArray(rows)||rows.length===0)return null;

    const row=rows[0];
    if(row.isDraft!==true){
      const error=new Error('Existing maintenance PR bukan Draft; broker berhenti fail-closed.');
      error.code='MAINTENANCE_DRAFT_EXISTING_NOT_DRAFT';
      throw error;
    }
    if(
      row.headRefName!==receipt.branchName||
      row.baseRefName!==receipt.baseBranch||
      row.headRefOid!==receipt.commitSha
    ){
      const error=new Error('Existing Draft PR branch/base/head tidak cocok checkpoint.');
      error.code='MAINTENANCE_DRAFT_EXISTING_MISMATCH';
      throw error;
    }
    return Object.freeze({
      number:Number(row.number)||0,
      url:String(row.url||''),
      draft:true,
      existing:true
    });
  }

  async publish({
    repoRoot,
    receipt,
    findingCode='MAINTENANCE_FIX'
  }={}){
    assertReceipt(receipt);
    const root=await this.verifyRepository(repoRoot);
    await this.verifyLocalCheckpoint(root,receipt);

    const existing=await this.existingDraft(root,receipt);
    if(existing)return existing;

    await this.run(
      'git',
      [
        'push',
        '--set-upstream',
        this.remote,
        'refs/heads/'+receipt.branchName+':refs/heads/'+receipt.branchName
      ],
      root
    );

    const title=safeText(
      '[AI maintenance] '+receipt.findingId+' — '+findingCode,
      120
    );
    const body=[
      '## Verified maintenance checkpoint',
      '',
      '- Finding: '+receipt.findingId,
      '- Branch: '+receipt.branchName,
      '- Base commit: '+receipt.baseHead,
      '- Verified commit: '+receipt.commitSha,
      '- Verification: trusted PASS',
      '',
      'This Draft PR was created by the trusted maintenance checkpoint broker.',
      'It does not grant merge, release, signing, Owner, or Creator authority.',
      '',
      '<!-- humanale-maintenance-checkpoint:'+receipt.findingFingerprint+' -->'
    ].join('\n');

    await this.run(
      ghExecutable(),
      [
        'pr','create',
        '--repo',this.expectedRepository,
        '--draft',
        '--head',receipt.branchName,
        '--base',receipt.baseBranch,
        '--title',title,
        '--body',body
      ],
      root
    );

    const created=await this.existingDraft(root,receipt);
    if(!created){
      const error=new Error('Draft PR tidak dapat diverifikasi setelah gh pr create.');
      error.code='MAINTENANCE_DRAFT_CREATE_UNVERIFIED';
      throw error;
    }

    return Object.freeze({
      ...created,
      existing:false,
      createdAt:this.now(),
      branchName:receipt.branchName,
      commitSha:receipt.commitSha
    });
  }
}

export function createTrustedDraftPRBroker(options){
  return new TrustedDraftPRBroker(options);
}
