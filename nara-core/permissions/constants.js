export const APPROVAL_MANAGER_VERSION='1.0.0';

export const APPROVAL_STATUS=Object.freeze({
  PENDING:'PENDING',
  APPROVED:'APPROVED',
  DENIED:'DENIED',
  REVOKED:'REVOKED',
  EXPIRED:'EXPIRED',
  CONSUMED:'CONSUMED'
});

export const DEFAULT_APPROVAL_LIMITS=Object.freeze({
  maxRequests:200,
  historyLimit:200,
  defaultTtlMs:10*60*1000,
  maxTtlMs:60*60*1000
});
