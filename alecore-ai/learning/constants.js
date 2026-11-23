export const LEARNING_ENGINE_VERSION='1.0.0';

export const LEARNING_SIGNAL_KINDS=Object.freeze([
  'execution',
  'verification',
  'feedback'
]);

export const LEARNING_OUTCOMES=Object.freeze([
  'success',
  'failure',
  'timeout',
  'blocked',
  'deferred',
  'neutral'
]);

export const LEARNING_FEEDBACK=Object.freeze([
  'positive',
  'negative',
  'neutral'
]);

export const LEARNING_AUTHORITIES=Object.freeze([
  'observed',
  'system',
  'verifier',
  'owner'
]);

export const LEARNING_PROPOSAL_TYPES=Object.freeze({
  REVIEW_RELIABILITY:'REVIEW_RELIABILITY',
  REVIEW_TIMEOUT:'REVIEW_TIMEOUT',
  REVIEW_FEEDBACK:'REVIEW_FEEDBACK'
});

export const DEFAULT_LEARNING_LIMITS=Object.freeze({
  maxSkills:100,
  maxSignalsPerSkill:64,
  maxGlobalSignals:256,
  maxLatencyMs:5*60*1000,
  maxTags:12,
  maxTagLength:48,
  minSamplesForProposal:5,
  failureRateThreshold:0.35,
  timeoutRateThreshold:0.25,
  negativeFeedbackThreshold:0.4,
  proposalHistoryLimit:100
});
