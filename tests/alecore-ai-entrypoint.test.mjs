import test from 'node:test';
import assert from 'node:assert/strict';
import { AleCoreOrchestrator, NaraOrchestrator } from '../alecore-ai/index.js';
import { ALECORE_AI_IDENTITY, NARA_IDENTITY, integrationPlan } from '../nara-core/engine/index.js';

test('AleCore AI public entry point exposes the orchestrator compatibility alias', () => {
  assert.equal(typeof AleCoreOrchestrator, 'function');
  assert.strictEqual(AleCoreOrchestrator, NaraOrchestrator);
});


test('AleCore AI identity is the current product identity while legacy identity remains readable', () => {
  assert.equal(ALECORE_AI_IDENTITY.id, 'ALECORE_AI');
  assert.equal(ALECORE_AI_IDENTITY.name, 'AleCore AI');
  assert.equal(ALECORE_AI_IDENTITY.identityVersion, 2);
  assert.equal(NARA_IDENTITY.id, 'NARA');
  assert.equal(integrationPlan({}).identity.id, 'ALECORE_AI');
});
