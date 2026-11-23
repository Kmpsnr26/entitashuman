export const READINESS_GATE_VERSION='1.1.0';

export const READINESS_STATUS=Object.freeze({
  NOT_READY:'NOT_READY',
  SIMULATION_READY:'SIMULATION_READY',
  LIVE_READY:'LIVE_READY'
});

export const READINESS_GATES=Object.freeze([
  'ale.decision.validated',
  'ale.memory.validated',
  'ale.execution.validated',
  'ale.verification.validated',
  'ale.learning.validated',
  'ale.workflow.validated',
  'ale.supervisor.validated',
  'ale.approval.validated',
  'integration.contract_validated',
  'integration.mock_bridge_validated',
  'security.codeql_pass',
  'security.quality_gate_pass',
  'humanale.real_test_pass',
  'humanale.final_ready',
  'humanale.baseline_frozen',
  'humanale.creator_final_approval'
]);

export const SIMULATION_REQUIRED_GATES=Object.freeze(
  READINESS_GATES.filter(gate=>!gate.startsWith('humanale.'))
);

export const LIVE_REQUIRED_GATES=Object.freeze([...READINESS_GATES]);

export const DEFAULT_READINESS_LIMITS=Object.freeze({
  historyLimit:50
});
