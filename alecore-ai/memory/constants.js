export const MEMORY_MANAGER_VERSION='1.0.0';

export const MEMORY_KINDS=Object.freeze([
  'working',
  'episodic',
  'reference'
]);

export const MEMORY_SENSITIVITY=Object.freeze([
  'normal',
  'sensitive'
]);

export const DEFAULT_MEMORY_LIMITS=Object.freeze({
  maxEntries:200,
  maxValueBytes:16*1024,
  maxTags:16,
  maxTagLength:48,
  maxTtlMs:30*24*60*60*1000,
  contextMaxEntries:12,
  contextMaxBytes:48*1024,
  contextRecordLimit:50,
  contextRecordTtlMs:5*60*1000
});
