export const HUMANALE_FINAL_READINESS_VERSION=1;

export const HUMANALE_FINAL_GATES=Object.freeze([
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

const freeze=value=>Object.freeze(value);
const bounded=(value,max=160)=>String(value??'').trim().slice(0,max);

function normalizeCheck(value={}){
  const status=['pass','fail','pending','blocked','na'].includes(value?.status)?value.status:'pending';
  return freeze({
    status,
    required:value?.required!==false,
    source:bounded(value?.source,80),
    note:bounded(value?.note,240),
    timestamp:Number(value?.timestamp)||0
  });
}

export function normalizeHumanALEReadinessEvidence(value={}){
  const checks={};
  for(const gate of HUMANALE_FINAL_GATES)checks[gate]=normalizeCheck(value?.checks?.[gate]);
  return freeze({
    version:HUMANALE_FINAL_READINESS_VERSION,
    generatedAt:Number(value?.generatedAt)||Date.now(),
    build:freeze({
      version:bounded(value?.build?.version,32),
      commit:bounded(value?.build?.commit,64),
      branch:bounded(value?.build?.branch,96)
    }),
    checks:freeze(checks),
    creatorApproval:freeze({
      approved:value?.creatorApproval?.approved===true,
      by:bounded(value?.creatorApproval?.by,80),
      note:bounded(value?.creatorApproval?.note,240),
      timestamp:Number(value?.creatorApproval?.timestamp)||0
    })
  });
}

export function evaluateHumanALEFinalReadiness(value={}){
  const evidence=normalizeHumanALEReadinessEvidence(value);
  const gates=HUMANALE_FINAL_GATES.map(id=>{
    const check=evidence.checks[id];
    const effectivePass=check.status==='pass'||(!check.required&&check.status==='na');
    return freeze({id,...check,effectivePass});
  });
  const required=gates.filter(gate=>gate.required);
  const failed=required.filter(gate=>gate.status==='fail');
  const blocked=required.filter(gate=>gate.status==='blocked');
  const pending=required.filter(gate=>gate.status!=='pass'&&gate.status!=='fail'&&gate.status!=='blocked');
  const technicalReady=required.length>0&&failed.length===0&&blocked.length===0&&pending.length===0;
  const creatorApproved=evidence.creatorApproval.approved===true;
  const integrationUnlocked=technicalReady&&creatorApproved;
  return freeze({
    protocol:'humanale-final-readiness/1',
    mode:'FAIL_CLOSED',
    technicalReady,
    creatorApproved,
    integrationUnlocked,
    finalState:integrationUnlocked?'FINAL_READY':'LOCKED',
    build:evidence.build,
    gates:freeze(gates),
    summary:freeze({
      total:gates.length,
      required:required.length,
      pass:required.filter(g=>g.status==='pass').length,
      fail:failed.length,
      blocked:blocked.length,
      pending:pending.length
    }),
    blockers:freeze([
      ...failed.map(g=>g.id+':FAIL'),
      ...blocked.map(g=>g.id+':BLOCKED'),
      ...pending.map(g=>g.id+':PENDING'),
      ...(technicalReady&&!creatorApproved?['creator-approval:PENDING']:[])
    ]),
    creatorApproval:evidence.creatorApproval
  });
}

export function assertHumanALEIntegrationUnlocked(value={}){
  const result=evaluateHumanALEFinalReadiness(value);
  if(!result.integrationUnlocked){
    const error=new Error('HumanALE belum FINAL_READY. Integrasi AleCore AI tetap dikunci.');
    error.code='HUMANALE_INTEGRATION_LOCKED';
    error.readiness=result;
    throw error;
  }
  return result;
}

export function createHumanALEReadinessCertificate(value={}){
  const result=evaluateHumanALEFinalReadiness(value);
  return freeze({
    protocol:result.protocol,
    certificateVersion:1,
    finalState:result.finalState,
    integrationUnlocked:result.integrationUnlocked,
    build:result.build,
    issuedAt:Date.now(),
    creatorApproval:result.creatorApproval,
    gates:result.gates.map(g=>freeze({id:g.id,status:g.status,required:g.required,source:g.source,timestamp:g.timestamp})),
    blockers:result.blockers
  });
}
