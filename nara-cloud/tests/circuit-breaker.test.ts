import test from "node:test";
import assert from "node:assert/strict";

import { ProviderCircuitBreaker } from "../src/ai/circuit-breaker.js";
import { AiProviderError } from "../src/ai/types.js";

const retryable = () =>
  new AiProviderError("temporary", {
    code: "TEMPORARY",
    retryable: true
  });

test("opens at threshold and allows one half-open probe", () => {
  let now = 1000;
  const breaker = new ProviderCircuitBreaker(2, 500, () => now);

  assert.equal(breaker.acquire("openai"), true);
  breaker.failure("openai", retryable());
  assert.equal(breaker.status("openai").state, "degraded");

  breaker.failure("openai", retryable());
  assert.equal(breaker.status("openai").state, "open");
  assert.equal(breaker.acquire("openai"), false);

  now += 500;
  assert.equal(breaker.status("openai").state, "half-open");
  assert.equal(breaker.acquire("openai"), true);
  assert.equal(breaker.acquire("openai"), false);

  breaker.success("openai");
  assert.equal(breaker.status("openai").state, "healthy");
});

test("failed half-open probe reopens circuit", () => {
  let now = 1000;
  const breaker = new ProviderCircuitBreaker(1, 500, () => now);

  breaker.failure("gemini", retryable());
  now += 500;
  assert.equal(breaker.acquire("gemini"), true);

  breaker.failure("gemini", retryable());
  assert.equal(breaker.status("gemini").state, "open");
});

test("non-retryable failures do not affect health", () => {
  const breaker = new ProviderCircuitBreaker(1, 500);
  const error = new AiProviderError("bad request", {
    code: "BAD_REQUEST",
    retryable: false
  });

  breaker.failure("anthropic", error);
  assert.equal(breaker.status("anthropic").state, "healthy");
  assert.equal(breaker.status("anthropic").totalFailures, 0);
});

test("unconfigured provider reports unavailable without secrets", () => {
  const breaker = new ProviderCircuitBreaker(2, 500);
  assert.deepEqual(
    breaker.status("compatible", false),
    {
      state: "unavailable",
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0
    }
  );
});
