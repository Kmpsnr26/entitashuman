/**
 * AleCore AI desktop agent coordinator facade.
 *
 * Implementation remains in the legacy module during the staged migration.
 * Keep this alias thin so existing coordinator behavior and lifecycle remain unchanged.
 */
export {
  NaraAgentCoordinator as AleCoreAgentCoordinator,
  createNaraAgentCoordinator as createAleCoreAgentCoordinator,
  NARA_AGENT_HANDLER_TIMEOUTS as ALECORE_AGENT_HANDLER_TIMEOUTS
} from './nara-agent-coordinator.mjs';
