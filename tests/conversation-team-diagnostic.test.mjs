import test from "node:test";
import assert from "node:assert/strict";
import { validateConversationTeamDiagnostic } from "../public/conversation-team-diagnostic.js";

const stage = (role, agent, text = role + " result") => ({ role, agent, text });

test("accepts two local executors with Planner and Reviewer sharing the read-only executor", () => {
  const result = {
    executors: ["codex", "github-copilot"],
    stages: [
      stage("planner", "codex"),
      stage("worker", "github-copilot"),
      stage("reviewer", "codex", "Checked. VERDICT: PASS"),
    ],
  };
  const checked = validateConversationTeamDiagnostic(result);
  assert.equal(checked.ok, true);
  assert.equal(checked.worker.agent, "github-copilot");
  assert.equal(checked.reviewer.agent, "codex");
});

test("accepts three distinct stage executors in the required order", () => {
  const result = {
    executors: ["codex", "github-copilot", "cursor"],
    stages: [
      stage("planner", "codex"),
      stage("worker", "github-copilot"),
      stage("reviewer", "cursor", "Review complete. VERDICT: PASS"),
    ],
  };
  assert.equal(validateConversationTeamDiagnostic(result).ok, true);
});

test("requires the Specialist stage when four executors are used", () => {
  const result = {
    executors: ["codex", "github-copilot", "cursor", "claude"],
    stages: [
      stage("planner", "codex"),
      stage("specialist", "claude"),
      stage("worker", "github-copilot"),
      stage("reviewer", "cursor", "Review complete. VERDICT: PASS"),
    ],
  };
  assert.equal(validateConversationTeamDiagnostic(result).ok, true);
});

test("rejects missing, unsupported, or unused executors", () => {
  assert.equal(validateConversationTeamDiagnostic({ stages: [] }).ok, false);
  assert.equal(
    validateConversationTeamDiagnostic({
      executors: ["codex", "unknown"],
      stages: [
        stage("planner", "codex"),
        stage("worker", "unknown"),
        stage("reviewer", "codex", "VERDICT: PASS"),
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConversationTeamDiagnostic({
      executors: ["codex", "github-copilot", "cursor"],
      stages: [
        stage("planner", "codex"),
        stage("worker", "github-copilot"),
        stage("reviewer", "codex", "VERDICT: PASS"),
      ],
    }).ok,
    false,
  );
});

test("rejects invalid stage ordering, duplicate Worker/Reviewer, or an independent-review failure", () => {
  const base = {
    executors: ["codex", "github-copilot"],
    stages: [
      stage("planner", "codex"),
      stage("worker", "github-copilot"),
      stage("reviewer", "codex", "VERDICT: PASS"),
    ],
  };
  assert.equal(
    validateConversationTeamDiagnostic({
      ...base,
      stages: [base.stages[1], base.stages[0], base.stages[2]],
    }).ok,
    false,
  );
  assert.equal(
    validateConversationTeamDiagnostic({
      ...base,
      stages: [
        stage("planner", "codex"),
        stage("worker", "github-copilot"),
        stage("reviewer", "github-copilot", "VERDICT: PASS"),
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConversationTeamDiagnostic({
      ...base,
      stages: [
        stage("planner", "codex"),
        stage("worker", "github-copilot"),
        stage("reviewer", "codex", "VERDICT: NEEDS_FIX"),
      ],
    }).ok,
    false,
  );
  assert.equal(
    validateConversationTeamDiagnostic({
      ...base,
      stages: [
        stage("planner", "codex"),
        stage("worker", "github-copilot"),
        stage("reviewer", "codex", "No verdict supplied"),
      ],
    }).ok,
    false,
  );
});
