export const DECISION_ENGINE_VERSION='1.0.0';
export const DECISION_POLICY_VERSION='1.0.0';

export const DECISION_OUTCOMES=Object.freeze({
  ALLOW:'ALLOW',
  REQUIRE_APPROVAL:'REQUIRE_APPROVAL',
  DEFER:'DEFER',
  BLOCK:'BLOCK'
});

export const DECISION_RISK_LEVELS=Object.freeze(['low','medium','high','critical']);

export const DECISION_REASON_CODES=Object.freeze({
  POLICY_ALLOW:'POLICY_ALLOW',
  INVALID_REQUEST:'INVALID_REQUEST',
  UNKNOWN_ACTION:'UNKNOWN_ACTION',
  SAFETY_STOP:'SAFETY_STOP',
  ACTION_DISABLED:'ACTION_DISABLED',
  CAPABILITY_REQUIRED:'CAPABILITY_REQUIRED',
  CAPABILITY_DENIED:'CAPABILITY_DENIED',
  CAPABILITY_NOT_READY:'CAPABILITY_NOT_READY',
  DEPENDENCY_NOT_READY:'DEPENDENCY_NOT_READY',
  GATE_NOT_READY:'GATE_NOT_READY',
  APPROVAL_REQUIRED:'APPROVAL_REQUIRED'
});

const policy=(definition)=>Object.freeze({
  enabled:true,
  risk:'low',
  capability:null,
  requiredApprovals:Object.freeze([]),
  requiredGates:Object.freeze([]),
  defaultDependencies:Object.freeze([]),
  ...definition,
  requiredApprovals:Object.freeze([...(definition.requiredApprovals||[])]),
  requiredGates:Object.freeze([...(definition.requiredGates||[])]),
  defaultDependencies:Object.freeze([...(definition.defaultDependencies||[])])
});

export const DEFAULT_ACTION_POLICIES=Object.freeze({
  observe:policy({risk:'low'}),
  reason:policy({risk:'low',capability:'reason'}),
  plan:policy({risk:'low',capability:'plan'}),
  'memory.read':policy({risk:'low',capability:'memory.read'}),
  'memory.write':policy({risk:'medium',capability:'memory.write'}),
  'skill.execute':policy({risk:'medium',capability:'$request'}),
  'external.read':policy({risk:'medium',capability:'$request'}),
  'external.write':policy({
    risk:'high',
    capability:'$request',
    requiredApprovals:['owner']
  }),
  'system.execute':policy({
    risk:'high',
    capability:'$request',
    requiredApprovals:['owner']
  }),
  'integration.handshake':policy({
    risk:'medium',
    capability:'sync',
    requiredGates:['humanale.final_ready','integration.contract_validated']
  }),
  'integration.command':policy({
    risk:'high',
    capability:'sync',
    requiredApprovals:['owner'],
    requiredGates:['humanale.final_ready','integration.contract_validated']
  })
});
