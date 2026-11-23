/**
 * Resolve canonical Creator credentials for AleCore AI.
 * Non-empty ALECORE_* values take precedence; legacy NARA_* names remain valid.
 */
export function resolveAleCoreCreatorCredentials(source = process.env) {
  const preferred = (current, legacy) => {
    if (typeof current === 'string' && current.trim()) return current;
    return typeof legacy === 'string' ? legacy : '';
  };

  const username = preferred(
    source.ALECORE_CREATOR_USERNAME,
    source.NARA_CREATOR_USERNAME
  ) || 'creator';
  const password = preferred(
    source.ALECORE_CREATOR_PASSWORD,
    source.NARA_CREATOR_PASSWORD
  );

  return Object.freeze({ username, password });
}
