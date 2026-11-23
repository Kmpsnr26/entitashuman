/**
 * Normalize the public AleCore AI environment names to the legacy internal
 * NARA Cloud keys. New names take precedence; legacy deployments keep working.
 * Do not log this object: it contains secret values.
 */
export function withAleCoreEnvAliases(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return {
    ...source,
    NARA_PORT: source.ALECORE_PORT ?? source.NARA_PORT,
    PUBLIC_NARA_ORIGIN:
      source.PUBLIC_ALECORE_ORIGIN ?? source.PUBLIC_NARA_ORIGIN,
    NARA_SESSION_SECRET:
      source.ALECORE_SESSION_SECRET ?? source.NARA_SESSION_SECRET
  };
}
