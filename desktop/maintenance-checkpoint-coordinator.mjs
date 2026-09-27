import {
  MAINTENANCE_AUTOPILOT_STATUS,
  normalizeMaintenanceFinding
} from './maintenance-autopilot.mjs';

export const MAINTENANCE_CHECKPOINT_COORDINATOR_VERSION='1.0.0';

function failureCode(error,fallback){
  return String(error?.code||fallback||'MAINTENANCE_COORDINATOR_FAILED')
    .replace(/[^A-Z0-9_.:-]/gi,'_')
    .slice(0,100);
}

export class TrustedMaintenanceCheckpointCoordinator{
  constructor({
    repoRoot,
    agentHub,
    autopilot,
    workspaceBroker,
    draftBroker,
    baseRef='HEAD',
    now=()=>Date.now()
  }={}){
    if(!repoRoot)throw new TypeError('Coordinator membutuhkan repoRoot.');
    if(!agentHub||typeof agentHub.getProjectRoot!=='function'||typeof agentHub.setProjectRoot!=='function'){
      throw new TypeError('Coordinator membutuhkan Agent Hub project-root controls.');
    }
    if(!autopilot||typeof autopilot.enqueue!=='function'||typeof autopilot.runNext!=='function'){
      throw new TypeError('Coordinator membutuhkan Safe Maintenance Autopilot.');
    }
    if(!workspaceBroker||typeof workspaceBroker.prepare!=='function'){
      throw new TypeError('Coordinator membutuhkan trusted workspace broker.');
    }
    if(!draftBroker||typeof draftBroker.publish!=='function'){
      throw new TypeError('Coordinator membutuhkan trusted Draft PR broker.');
    }

    this.repoRoot=repoRoot;
    this.agentHub=agentHub;
    this.autopilot=autopilot;
    this.workspaceBroker=workspaceBroker;
    this.draftBroker=draftBroker;
    this.baseRef=String(baseRef||'HEAD');
    this.now=now;
    this.busy=false;
    this.pending=null;
  }

  snapshot(){
    return Object.freeze({
      version:MAINTENANCE_CHECKPOINT_COORDINATOR_VERSION,
      realtime:false,
      busy:this.busy,
      pending:Boolean(this.pending),
      pendingStage:this.pending?.stage||null,
      pendingFindingId:this.pending?.findingId||null,
      autopilot:this.autopilot.snapshot()
    });
  }

  async runFinding(rawFinding){
    if(this.busy){
      return Object.freeze({status:'BLOCKED',reason:'COORDINATOR_BUSY'});
    }
    if(this.pending){
      return Object.freeze({
        status:'BLOCKED',
        reason:'CHECKPOINT_RECOVERY_REQUIRED',
        stage:this.pending.stage
      });
    }

    const finding=normalizeMaintenanceFinding(rawFinding,this.now);
    if(this.autopilot.hasFinding(finding)){
      return Object.freeze({
        status:'REJECTED',
        reason:'DUPLICATE',
        findingId:finding.id
      });
    }

    this.busy=true;
    let workspace=null;
    let queued=false;
    const originalRoot=this.agentHub.getProjectRoot();

    try{
      workspace=await this.workspaceBroker.prepare({
        repoRoot:this.repoRoot,
        finding:{
          id:finding.id,
          fingerprint:finding.fingerprint
        },
        baseRef:this.baseRef
      });

      const queuedResult=this.autopilot.enqueue(rawFinding);
      if(!queuedResult.accepted){
        await this.workspaceBroker.discard(workspace);
        return Object.freeze({
          status:'REJECTED',
          reason:queuedResult.reason,
          findingId:finding.id
        });
      }
      queued=true;

      this.agentHub.setProjectRoot(workspace.path);
      let runResult;
      try{
        runResult=await this.autopilot.runNext();
      }finally{
        this.agentHub.setProjectRoot(originalRoot);
      }

      if(runResult.status!==MAINTENANCE_AUTOPILOT_STATUS.VERIFIED){
        await this.workspaceBroker.discard(workspace);
        return Object.freeze({
          ...runResult,
          isolatedWorkspace:true
        });
      }

      const activeWorkspace=this.workspaceBroker.get(workspace.id)||workspace;
      this.pending={
        stage:'checkpoint',
        findingId:finding.id,
        findingCode:finding.code,
        findingFingerprint:finding.fingerprint,
        workspace:activeWorkspace,
        receipt:null,
        draft:null,
        verified:true,
        startedAt:this.now()
      };

      return await this.publishPendingInternal();
    }catch(error){
      this.agentHub.setProjectRoot(originalRoot);
      if(workspace&&!this.pending){
        try{await this.workspaceBroker.discard(workspace);}catch{}
      }
      if(queued&&this.autopilot.currentCheckpoint()&&!this.pending){
        this.pending={
          stage:'manual-recovery',
          findingId:finding.id,
          findingCode:finding.code,
          findingFingerprint:finding.fingerprint,
          workspace,
          receipt:null,
          draft:null,
          verified:true,
          startedAt:this.now(),
          failureCode:failureCode(error,'CHECKPOINT_STATE_LOST')
        };
        return Object.freeze({
          status:'RECOVERY_REQUIRED',
          findingId:finding.id,
          reason:this.pending.failureCode
        });
      }
      throw error;
    }finally{
      this.busy=false;
    }
  }

  async publishPendingInternal(){
    const pending=this.pending;
    if(!pending){
      return Object.freeze({status:'IDLE',reason:'NO_PENDING_CHECKPOINT'});
    }

    if(pending.stage==='manual-recovery'){
      return Object.freeze({
        status:'RECOVERY_REQUIRED',
        findingId:pending.findingId,
        reason:pending.failureCode||'MANUAL_RECOVERY_REQUIRED'
      });
    }

    if(pending.stage==='checkpoint'){
      try{
        const receipt=await this.workspaceBroker.checkpoint(
          pending.workspace,
          {
            verification:{ok:pending.verified===true},
            title:'AI maintenance '+pending.findingId
          }
        );
        pending.receipt=receipt;
        pending.workspace=this.workspaceBroker.get(pending.workspace.id)||pending.workspace;
        pending.stage='publish';
      }catch(error){
        pending.failureCode=failureCode(error,'CHECKPOINT_FAILED');
        return Object.freeze({
          status:'CHECKPOINT_PENDING',
          findingId:pending.findingId,
          reason:pending.failureCode
        });
      }
    }

    if(pending.stage==='publish'){
      try{
        pending.draft=await this.draftBroker.publish({
          repoRoot:this.repoRoot,
          receipt:pending.receipt,
          findingCode:pending.findingCode
        });
        this.autopilot.acceptCheckpoint({
          ...pending.receipt,
          ...pending.draft,
          verified:true,
          draft:true,
          findingId:pending.findingId,
          findingFingerprint:pending.findingFingerprint
        });
        pending.stage='cleanup';
      }catch(error){
        pending.failureCode=failureCode(error,'DRAFT_PR_PUBLISH_FAILED');
        return Object.freeze({
          status:'PUBLISH_PENDING',
          findingId:pending.findingId,
          reason:pending.failureCode,
          branchName:pending.receipt?.branchName||null
        });
      }
    }

    if(pending.stage==='cleanup'){
      try{
        await this.workspaceBroker.finalizePublished(
          pending.workspace,
          pending.draft
        );
      }catch(error){
        pending.failureCode=failureCode(error,'WORKSPACE_CLEANUP_FAILED');
        return Object.freeze({
          status:'CLEANUP_PENDING',
          findingId:pending.findingId,
          reason:pending.failureCode,
          draftUrl:pending.draft?.url||null
        });
      }

      const result=Object.freeze({
        status:'DRAFT_PR_CREATED',
        findingId:pending.findingId,
        branchName:pending.receipt.branchName,
        commitSha:pending.receipt.commitSha,
        draftUrl:pending.draft.url,
        draftNumber:pending.draft.number||null,
        existingDraft:pending.draft.existing===true,
        realtime:false
      });
      this.pending=null;
      return result;
    }

    return Object.freeze({
      status:'RECOVERY_REQUIRED',
      findingId:pending.findingId,
      reason:'UNKNOWN_PENDING_STAGE'
    });
  }

  async resumePending(){
    if(this.busy){
      return Object.freeze({status:'BLOCKED',reason:'COORDINATOR_BUSY'});
    }
    if(!this.pending){
      return Object.freeze({status:'IDLE',reason:'NO_PENDING_CHECKPOINT'});
    }

    this.busy=true;
    try{
      return await this.publishPendingInternal();
    }finally{
      this.busy=false;
    }
  }
}

export function createMaintenanceCheckpointCoordinator(options){
  return new TrustedMaintenanceCheckpointCoordinator(options);
}
