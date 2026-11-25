import test from 'node:test';
import assert from 'node:assert/strict';
import { NaraAgentCoordinator } from '../desktop/nara-agent-coordinator.mjs';

test('NARA Agent Coordinator refuses to run while unrelated tasks are queued', async () => {
  let createGoalCalled = false;
  const nara = {
    registerAutopilotHandler() {},
    queueAutopilotTask() { throw new Error('must not queue a new task'); },
    runAutopilotOnce() { throw new Error('must not drain unrelated tasks'); },
    snapshot() {
      return {
        engine: {
          autopilot: {
            scheduler: {
              tasks: [{ id: 'unrelated-task', status: 'queued' }]
            }
          }
        }
      };
    },
    createGoal() { createGoalCalled = true; }
  };
  const agentHub = { async run() { throw new Error('must not run'); } };
  const coordinator = new NaraAgentCoordinator({ nara, agentHub });

  await assert.rejects(
    coordinator.run({
      id: 'humanale-orchestrator',
      mode: 'analyze',
      prompt: 'Analisis read-only.'
    }),
    /NARA Autopilot sedang memiliki task lain/
  );
  assert.equal(createGoalCalled, false);
});
