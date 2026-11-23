import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AleCoreAgentCoordinator,
  createAleCoreAgentCoordinator,
  ALECORE_AGENT_HANDLER_TIMEOUTS
} from '../desktop/alecore-agent-coordinator.mjs';
import {
  NaraAgentCoordinator,
  createNaraAgentCoordinator,
  NARA_AGENT_HANDLER_TIMEOUTS
} from '../desktop/nara-agent-coordinator.mjs';

test('AleCore desktop facade preserves legacy coordinator implementation and limits', () => {
  assert.strictEqual(AleCoreAgentCoordinator, NaraAgentCoordinator);
  assert.strictEqual(createAleCoreAgentCoordinator, createNaraAgentCoordinator);
  assert.strictEqual(ALECORE_AGENT_HANDLER_TIMEOUTS, NARA_AGENT_HANDLER_TIMEOUTS);
  assert.equal(typeof AleCoreAgentCoordinator, 'function');
});
