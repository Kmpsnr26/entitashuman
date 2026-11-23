import test from 'node:test';
import assert from 'node:assert/strict';
import { AleCoreOrchestrator, NaraOrchestrator } from '../alecore-ai/index.js';

test('AleCore AI public entry point exposes the orchestrator compatibility alias', () => {
  assert.equal(typeof AleCoreOrchestrator, 'function');
  assert.strictEqual(AleCoreOrchestrator, NaraOrchestrator);
});
