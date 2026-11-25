import test from 'node:test';
import assert from 'node:assert/strict';
import { NaraAgentCoordinator } from '../desktop/nara-agent-coordinator.mjs';

test('NARA Agent Coordinator reports specialist readiness as blocked by unrelated queued tasks', async () => {
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
  assert.equal(coordinator.canRun(), false);
  assert.equal(createGoalCalled, false);
});
