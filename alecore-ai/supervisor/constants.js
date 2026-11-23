export const SUPERVISOR_VERSION='1.0.0';

export const SUPERVISOR_STATUS=Object.freeze([
  'healthy',
  'degraded',
  'error',
  'offline',
  'stale'
]);

export const CIRCUIT_STATE=Object.freeze({
  CLOSED:'CLOSED',
  OPEN:'OPEN',
  HALF_OPEN:'HALF_OPEN'
});

export const RECOVERY_RECOMMENDATION=Object.freeze({
  NONE:'NONE',
  WAIT_COOLDOWN:'WAIT_COOLDOWN',
  RUN_HEALTH_PROBE:'RUN_HEALTH_PROBE',
  REVIEW_COMPONENT:'REVIEW_COMPONENT',
  CHECK_DEPENDENCY:'CHECK_DEPENDENCY'
});

export const DEFAULT_SUPERVISOR_LIMITS=Object.freeze({
  maxComponents:64,
  incidentHistoryLimit:128,
  componentHistoryLimit:32,
  defaultHeartbeatTimeoutMs:15000,
  defaultErrorWindowMs:60000,
  defaultErrorThreshold:3,
  defaultCooldownMs:30000,
  maxLatencyMs:5*60*1000
});
