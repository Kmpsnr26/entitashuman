import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TrustedDraftPRBroker
} from '../desktop/maintenance-draft-pr-broker.mjs';

const receipt=Object.freeze({
  workspaceId:'workspace-1',
  branchName:'automation/maintenance/render-failure-1-aaaaaaaaaaaa',
  baseBranch:'codex/feature-base',
  baseHead:'1'.repeat(40),
  commitSha:'2'.repeat(40),
  verified:true,
  findingId:'render-failure-1',
  findingFingerprint:'a'.repeat(64)
});

function fakeRunner({existing=false,existingDraft=true}={}){
  const calls=[];
  let created=existing;
  const runner=async(command,args,{cwd}={})=>{
    calls.push({command,args:[...args],cwd});
    if(command==='git'&&args[0]==='remote'){
      return {code:0,stdout:'https://github.com/Kmpsnr26/entitashuman.git\n',stderr:''};
    }
    if(command==='git'&&args[0]==='rev-parse'){
      if(args[1]==='refs/heads/'+receipt.branchName){
        return {code:0,stdout:receipt.commitSha+'\n',stderr:''};
      }
      if(args[1]===receipt.commitSha+'^'){
        return {code:0,stdout:receipt.baseHead+'\n',stderr:''};
      }
    }
    if(command==='git'&&args[0]==='push'){
      return {code:0,stdout:'pushed\n',stderr:''};
    }
    if(/gh(?:\.exe)?$/.test(command)&&args[0]==='pr'&&args[1]==='list'){
      const rows=created?[{
        number:999,
        url:'https://github.com/Kmpsnr26/entitashuman/pull/999',
        isDraft:existingDraft,
        baseRefName:receipt.baseBranch,
        headRefName:receipt.branchName,
        headRefOid:receipt.commitSha
      }]:[];
      return {code:0,stdout:JSON.stringify(rows),stderr:''};
    }
    if(/gh(?:\.exe)?$/.test(command)&&args[0]==='pr'&&args[1]==='create'){
      created=true;
      return {code:0,stdout:'https://github.com/Kmpsnr26/entitashuman/pull/999\n',stderr:''};
    }
    throw new Error('unexpected command: '+command+' '+args.join(' '));
  };
  return {runner,calls};
}

test('broker refuses unverified checkpoint and non-maintenance branch',async()=>{
  const fx=fakeRunner();
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:fx.runner
  });
  await assert.rejects(
    ()=>broker.publish({repoRoot:'.',receipt:{...receipt,verified:false}}),
    error=>error?.code==='MAINTENANCE_DRAFT_VERIFY_REQUIRED'
  );
  await assert.rejects(
    ()=>broker.publish({repoRoot:'.',receipt:{...receipt,branchName:'main'}}),
    error=>error?.code==='MAINTENANCE_DRAFT_BRANCH_DENIED'
  );
  assert.equal(fx.calls.length,0);
});

test('broker validates exact GitHub origin before publishing',async()=>{
  const calls=[];
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:async(command,args)=>{
      calls.push({command,args});
      if(command==='git'&&args[0]==='remote'){
        return {code:0,stdout:'https://github.com/other/repo.git\n',stderr:''};
      }
      throw new Error('should stop before other commands');
    }
  });
  await assert.rejects(
    ()=>broker.publish({repoRoot:'.',receipt}),
    error=>error?.code==='MAINTENANCE_DRAFT_REMOTE_MISMATCH'
  );
  assert.equal(calls.length,1);
});

test('broker pushes only exact maintenance branch and creates Draft PR with fixed flags',async()=>{
  const fx=fakeRunner();
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:fx.runner,
    now:()=>123
  });
  const result=await broker.publish({
    repoRoot:'.',
    receipt,
    findingCode:'AVATAR_RENDER_FAIL'
  });
  assert.equal(result.draft,true);
  assert.equal(result.existing,false);

  const push=fx.calls.find(call=>call.command==='git'&&call.args[0]==='push');
  assert.deepEqual(push.args,[
    'push','--set-upstream','origin',
    'refs/heads/'+receipt.branchName+':refs/heads/'+receipt.branchName
  ]);
  assert.equal(push.args.includes('--force'),false);
  assert.equal(push.args.includes('--force-with-lease'),false);

  const create=fx.calls.find(call=>/gh(?:\.exe)?$/.test(call.command)&&call.args[1]==='create');
  assert.ok(create.args.includes('--draft'));
  assert.ok(create.args.includes('--head'));
  assert.ok(create.args.includes(receipt.branchName));
  assert.ok(create.args.includes('--base'));
  assert.ok(create.args.includes(receipt.baseBranch));
  assert.equal(create.args.includes('merge'),false);
  assert.equal(create.args.includes('ready'),false);
});

test('existing Draft PR is reused without another push or create',async()=>{
  const fx=fakeRunner({existing:true});
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:fx.runner
  });
  const result=await broker.publish({repoRoot:'.',receipt});
  assert.equal(result.existing,true);
  assert.equal(fx.calls.some(call=>call.command==='git'&&call.args[0]==='push'),false);
  assert.equal(
    fx.calls.some(call=>/gh(?:\.exe)?$/.test(call.command)&&call.args[1]==='create'),
    false
  );
});

test('existing non-Draft PR fails closed and is never modified',async()=>{
  const fx=fakeRunner({existing:true,existingDraft:false});
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:fx.runner
  });
  await assert.rejects(
    ()=>broker.publish({repoRoot:'.',receipt}),
    error=>error?.code==='MAINTENANCE_DRAFT_EXISTING_NOT_DRAFT'
  );
  assert.equal(fx.calls.some(call=>call.args.includes('edit')),false);
});

test('broker public surface has no merge release signing or approval methods',()=>{
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner:async()=>({code:0,stdout:'',stderr:''})
  });
  for(const method of [
    'merge','approve','release','publishRelease','sign',
    'forcePush','deleteBranchProtection','creatorApproval'
  ]){
    assert.equal(typeof broker[method],'undefined',method);
  }
});


test('existing Draft PR with stale head SHA fails closed',async()=>{
  const calls=[];
  const runner=async(command,args)=>{
    calls.push({command,args:[...args]});
    if(command==='git'&&args[0]==='remote'){
      return {code:0,stdout:'https://github.com/Kmpsnr26/entitashuman.git\n',stderr:''};
    }
    if(command==='git'&&args[0]==='rev-parse'){
      if(args[1]==='refs/heads/'+receipt.branchName){
        return {code:0,stdout:receipt.commitSha+'\n',stderr:''};
      }
      return {code:0,stdout:receipt.baseHead+'\n',stderr:''};
    }
    if(/gh(?:\.exe)?$/.test(command)&&args[1]==='list'){
      return {code:0,stdout:JSON.stringify([{
        number:999,
        url:'https://github.com/Kmpsnr26/entitashuman/pull/999',
        isDraft:true,
        baseRefName:receipt.baseBranch,
        headRefName:receipt.branchName,
        headRefOid:'3'.repeat(40)
      }]),stderr:''};
    }
    throw new Error('unexpected');
  };
  const broker=new TrustedDraftPRBroker({
    expectedRepository:'Kmpsnr26/entitashuman',
    runner
  });
  await assert.rejects(
    ()=>broker.publish({repoRoot:'.',receipt}),
    error=>error?.code==='MAINTENANCE_DRAFT_EXISTING_MISMATCH'
  );
  assert.equal(calls.some(call=>call.command==='git'&&call.args[0]==='push'),false);
});
