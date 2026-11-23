import test from "node:test";
import assert from "node:assert/strict";
import {
  ALECORE_AI_SYSTEM_PROMPT,
  NARA_SYSTEM_PROMPT
} from "../src/ai/systemPrompt.js";

test("AleCore AI is the current cloud system identity with a legacy export alias", () => {
  assert.match(ALECORE_AI_SYSTEM_PROMPT, /AleCore AI/);
  assert.strictEqual(NARA_SYSTEM_PROMPT, ALECORE_AI_SYSTEM_PROMPT);
});
