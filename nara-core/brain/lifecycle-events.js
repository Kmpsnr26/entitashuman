export const ALECORE_LIFECYCLE_EVENTS = Object.freeze({
  start: 'alecore.start',
  shutdown: 'alecore.shutdown'
});

/**
 * Legacy lifecycle events remain accepted during the staged migration.
 * These aliases are intentionally not used as the canonical public events.
 */
export const LEGACY_LIFECYCLE_EVENTS = Object.freeze({
  start: 'nara.start',
  shutdown: 'nara.shutdown'
});

export function canonicalLifecycleEvent(event) {
  if (event === LEGACY_LIFECYCLE_EVENTS.start) return ALECORE_LIFECYCLE_EVENTS.start;
  if (event === LEGACY_LIFECYCLE_EVENTS.shutdown) return ALECORE_LIFECYCLE_EVENTS.shutdown;
  return event;
}
