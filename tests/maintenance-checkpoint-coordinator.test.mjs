import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SafeMaintenanceAutopilot
} from '../desktop/maintenance-autopilot.mjs';
import {
  TrustedMaintenanceCheckpointCoordinator
} from '../desktop/maintenance-checkpoint-coordinator.mjs';

function finding(overrides={}){
  return {
    id:'finding-1',
    source:'test',
    code:'AVATAR_RENDER_FAIL',
    summary:'avatar renderer unit test gagal setelah perubahan layout',
    severity:'medium',
    timestamp:100,
    ...overrides
  };
}

function fixture({
  verifyFails=false,
  publishFailsOnce=false,
  cleanupFailsOnce=false
}={}){
  let root='/source';
  let verifyCalls=0,publishCalls=0,cleanupCalls=0,discardCalls=0;
  let checkpointedWorkspace=null;

  const verifier={
    async verify(){
      verifyCalls++;
      if(verifyFails){
        return {
          ok:false,
          profile:'full',
          failureCode:'CHECK_FAILED',
          checks:[{ok:false,failureCode:'CHECK_FAILED',failureTail:'failed'}]
        };
      }
      return {
        ok:true,
        profile:'full',
        durationMs:5,
        checks:[{id:'npm-verify',ok:true}]
      };
    }
  };

  const agentHub={
    projectRoot:root,
    getProjectRoot(){return this.projectRoot;},
    setProjectRoot(value){this.projectRoot=value;},
    async runMaintenanceVerified(value,trustedVerifier){
      const report=await trustedVerifier({
        cwd:this.projectRoot,
        transactionId:'tx-1',
        changedFiles:2,
        totalBytes:100
      });
      if(report.ok!==true){
        const error=new Error('verify failed');
        error.code='AI_MAINTENANCE_TRUSTED_VERIFY_FAILED';
        error.verification=report;
        throw error;
      }
      return {
        id:value.id,
        maintenance:{changedFiles:2,totalBytes:100},
        trustedVerification:{profile:'full',durationMs:5,checkCount:1}
      };
    }
  };

  const verifierAutopilot=new SafeMaintenanceAutopilot({
    agentHub,
    verifier
  });

  const workspaceBroker={
    state:null,
    async prepare({finding}){
      this.state={
        id:'workspace-1',
        path:'/isolated/worktree',
        repoRoot:root,
        branchName:'automation/maintenance/'+finding.id+'-'+finding.fingerprint.slice(0,12),
        baseBranch:'codex/base',
        baseHead:'1'.repeat(40),
        findingId:finding.id,
        findingFingerprint:finding.fingerprint,
        checkpointed:false
      };
      return this.state;
    },
    get(id){
      return this.state?.id===id?this.state:null;
    },
    async checkpoint(workspace,{verification}){
      assert.equal(verification.ok,true);
      this.state={
        ...workspace,
        checkpointed:true,
        commitSha:'2'.repeat(40)
      };
      checkpointedWorkspace=this.state;
      return {
        workspaceId:workspace.id,
        branchName:workspace.branchName,
        baseBranch:workspace.baseBranch,
        baseHead:workspace.baseHead,
        commitSha:'2'.repeat(40),
        verified:true,
        findingId:workspace.findingId,
        findingFingerprint:workspace.findingFingerprint
      };
    },
    async finalizePublished(workspace,draft){
      cleanupCalls++;
      if(cleanupFailsOnce&&cleanupCalls===1){
        const error=new Error('cleanup');
        error.code='CLEANUP_FAILED';
        throw error;
      }
      assert.equal(workspace.commitSha,'2'.repeat(40));
      assert.equal(draft.commitSha,'2'.repeat(40));
      this.state=null;
      return true;
    },
    async discard(){
      discardCalls++;
      this.state=null;
      return true;
    }
  };

  const draftBroker={
    async publish({receipt}){
      publishCalls++;
      if(publishFailsOnce&&publishCalls===1){
        const error=new Error('gh unavailable');
        error.code='DRAFT_PR_PUBLISH_FAILED';
        throw error;
      }
      return {
        number:999,
        url:'https://github.com/Kmpsnr26/entitashuman/pull/999',
        draft:true,
        existing:false,
        branchName:receipt.branchName,
        commitSha:receipt.commitSha,
        findingId:receipt.findingId,
        findingFingerprint:receipt.findingFingerprint
      };
    }
  };

  const coordinator=new TrustedMaintenanceCheckpointCoordinator({
    repoRoot:root,
    agentHub,
    autopilot:verifierAutopilot,
    workspaceBroker,
    draftBroker,
    baseRef:'HEAD',
    now:(()=>{let n=1000;return()=>++n;})()
  });

  return {
    coordinator,
    agentHub,
    autopilot:verifierAutopilot,
    workspaceBroker,
    draftBroker,
    get verifyCalls(){return verifyCalls;},
    get publishCalls(){return publishCalls;},
    get cleanupCalls(){return cleanupCalls;},
    get discardCalls(){return discardCalls;},
    get checkpointedWorkspace(){return checkpointedWorkspace;}
  };
}

test('coordinator runs repair only inside isolated workspace then creates Draft PR checkpoint',async()=>{
  const fx=fixture();
  const result=await fx.coordinator.runFinding(finding());
  assert.equal(result.status,'DRAFT_PR_CREATED');
  assert.equal(result.realtime,false);
  assert.equal(result.draftUrl,'https://github.com/Kmpsnr26/entitashuman/pull/999');
  assert.equal(fx.agentHub.getProjectRoot(),'/source');
  assert.equal(fx.publishCalls,1);
  assert.equal(fx.cleanupCalls,1);
  assert.equal(fx.autopilot.snapshot().checkpointPending,false);
  assert.equal(fx.coordinator.snapshot().pending,false);
});

test('failed trusted verification discards isolated workspace and never publishes',async()=>{
  const fx=fixture({verifyFails:true});
  const result=await fx.coordinator.runFinding(finding());
  assert.equal(result.status,'FAILED');
  assert.equal(result.attempts,2);
  assert.equal(fx.publishCalls,0);
  assert.equal(fx.discardCalls,1);
  assert.equal(fx.agentHub.getProjectRoot(),'/source');
});

test('Draft PR publish failure preserves checkpoint and blocks new work until resume succeeds',async()=>{
  const fx=fixture({publishFailsOnce:true});
  const first=await fx.coordinator.runFinding(finding());
  assert.equal(first.status,'PUBLISH_PENDING');
  assert.equal(fx.autopilot.snapshot().checkpointPending,true);
  assert.equal(fx.coordinator.snapshot().pendingStage,'publish');

  const blocked=await fx.coordinator.runFinding(finding({
    id:'finding-2',
    code:'NEXT_FAIL',
    summary:'another isolated test failure'
  }));
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(blocked.reason,'CHECKPOINT_RECOVERY_REQUIRED');

  const resumed=await fx.coordinator.resumePending();
  assert.equal(resumed.status,'DRAFT_PR_CREATED');
  assert.equal(fx.publishCalls,2);
  assert.equal(fx.autopilot.snapshot().checkpointPending,false);
});

test('cleanup failure remains blocking even after Draft PR exists and can be resumed',async()=>{
  const fx=fixture({cleanupFailsOnce:true});
  const first=await fx.coordinator.runFinding(finding());
  assert.equal(first.status,'CLEANUP_PENDING');
  assert.equal(first.draftUrl,'https://github.com/Kmpsnr26/entitashuman/pull/999');
  assert.equal(fx.autopilot.snapshot().checkpointPending,false);
  assert.equal(fx.coordinator.snapshot().pendingStage,'cleanup');

  const resumed=await fx.coordinator.resumePending();
  assert.equal(resumed.status,'DRAFT_PR_CREATED');
  assert.equal(fx.cleanupCalls,2);
  assert.equal(fx.coordinator.snapshot().pending,false);
});

test('duplicate finding is rejected before workspace preparation',async()=>{
  const fx=fixture();
  assert.equal((await fx.coordinator.runFinding(finding())).status,'DRAFT_PR_CREATED');
  const second=await fx.coordinator.runFinding(finding());
  assert.equal(second.status,'REJECTED');
  assert.equal(second.reason,'DUPLICATE');
});

test('coordinator exposes no realtime merge release signing or Creator approval methods',()=>{
  const fx=fixture();
  const snapshot=fx.coordinator.snapshot();
  assert.equal(snapshot.realtime,false);
  for(const method of [
    'startRealtime','schedule','merge','release','sign',
    'approveCreator','autoMerge','publishRelease'
  ]){
    assert.equal(typeof fx.coordinator[method],'undefined',method);
  }
});
