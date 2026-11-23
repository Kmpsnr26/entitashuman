/**
 * Resolve canonical AleCore Cloud origins while preserving existing deployments.
 * Non-empty ALECORE_* values win; blank/missing values fall back to NARA_* aliases.
 */
export function resolveAleCoreCloudOrigins(source = process.env) {
  const preferred = (current, legacy) => {
    const value = typeof current === 'string' ? current.trim() : '';
    if (value) return value;
    return typeof legacy === 'string' ? legacy.trim() : '';
  };

  const cloudOrigin = preferred(
    source.ALECORE_CLOUD_ORIGIN,
    source.NARA_CLOUD_ORIGIN
  );
  const authOrigin = preferred(
    source.ALECORE_AUTH_ORIGIN,
    source.NARA_AUTH_ORIGIN
  ) || cloudOrigin;

  return Object.freeze({ cloudOrigin, authOrigin });
}
