import test from "node:test";
import assert from "node:assert/strict";

import {
  ProviderHealthRegistry
} from "../src/ai/provider-health.js";

import {
  AiGateway
} from "../src/ai/gateway.js";

import {
  AiProviderError,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiStreamCompleted
} from "../src/ai/types.js";

const request: AiRequest = {
  message: "halo",
  history: []
};

class FakeProvider
  implements AiProvider {

  readonly id: string;
  readonly model: string;

  calls = 0;

  private readonly generateImpl:
    (
      request: AiRequest,
      signal: AbortSignal
    ) => Promise<AiResult>;

  constructor(
    id: string,
    generateImpl:
      FakeProvider["generateImpl"]
  ) {
    this.id = id;
    this.model =
      id + "-model";
    this.generateImpl =
      generateImpl;
  }

  configured(): boolean {
    return true;
  }

  async generate(
    input: AiRequest,
    signal: AbortSignal
  ): Promise<AiResult> {
    this.calls += 1;

    return this.generateImpl(
      input,
      signal
    );
  }

  async stream(
    input: AiRequest,
    signal: AbortSignal,
    onDelta:
      (
        delta: string
      ) =>
        void |
        Promise<void>
  ): Promise<AiStreamCompleted> {
    const result =
      await this.generate(
        input,
        signal
      );

    await onDelta(
      result.text
    );

    return {
      provider:
        result.provider,
      model:
        result.model,
      usage:
        result.usage
    };
  }
}

function retryable(
  code = "TEMPORARY"
): AiProviderError {
  return new AiProviderError(
    "temporary",
    {
      code,
      retryable:
        true
    }
  );
}

test(
  "configured provider starts ready with empty bounded metrics",
  () => {
    const health =
      new ProviderHealthRegistry();

    const snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "ready"
    );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.successes,
      0
    );

    assert.equal(
      snapshot.failures,
      0
    );

    assert.equal(
      snapshot.successRate,
      null
    );

    assert.equal(
      snapshot.averageLatencyMs,
      null
    );
  }
);

test(
  "unconfigured provider is unavailable without creating fake failures",
  () => {
    const health =
      new ProviderHealthRegistry();

    const snapshot =
      health.snapshot(
        "gemini",
        false
      );

    assert.equal(
      snapshot.state,
      "unavailable"
    );

    assert.equal(
      snapshot.circuitState,
      "unavailable"
    );

    assert.equal(
      snapshot.failures,
      0
    );
  }
);

test(
  "retryable failures degrade then open the circuit with safe telemetry",
  () => {
    let now = 10_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          2,
        cooldownMs:
          5_000,
        now:
          () => now
      });

    health.failure(
      "openai",
      {
        retryable:
          true,
        latencyMs:
          120,
        errorCode:
          "rate limit / private detail"
      }
    );

    let snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "degraded"
    );

    assert.equal(
      snapshot.circuitState,
      "degraded"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      1
    );

    assert.equal(
      snapshot.failures,
      1
    );

    assert.equal(
      snapshot.lastLatencyMs,
      120
    );

    assert.equal(
      snapshot.lastErrorCode,
      "rate_limit___private_detail"
    );

    now += 1;

    health.failure(
      "openai",
      {
        retryable:
          true,
        latencyMs:
          180,
        errorCode:
          "UPSTREAM_503"
      }
    );

    snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "unavailable"
    );

    assert.equal(
      snapshot.circuitState,
      "open"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      2
    );

    assert.equal(
      snapshot.failures,
      2
    );

    assert.equal(
      snapshot.successRate,
      0
    );

    assert.equal(
      snapshot.averageLatencyMs,
      132
    );

    assert.equal(
      snapshot.nextProbeAt,
      now + 5_000
    );
  }
);

test(
  "non-retryable failures are telemetry-only and do not change breaker health",
  () => {
    let now = 15_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    health.failure(
      "openai",
      {
        retryable:
          false,
        latencyMs:
          25,
        errorCode:
          "BAD_REQUEST"
      }
    );

    let snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "ready"
    );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      0
    );

    assert.equal(
      snapshot.failures,
      1
    );

    health.retryableFailure(
      "openai",
      50,
      "TEMP"
    );

    const openedAt =
      health.snapshot(
        "openai",
        true
      ).openedAt;

    now += 1_001;

    const probe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      probe.allowed,
      true
    );

    assert.equal(
      probe.circuitState,
      "half-open"
    );

    health.failure(
      "openai",
      {
        retryable:
          false,
        latencyMs:
          30,
        errorCode:
          "REQUEST_SPECIFIC"
      }
    );

    snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "half-open"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      1
    );

    assert.equal(
      snapshot.openedAt,
      openedAt
    );

    assert.equal(
      snapshot.probeInFlight,
      false
    );

    const nextProbe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      nextProbe.allowed,
      true
    );

    assert.equal(
      nextProbe.probe,
      true
    );
  }
);

test(
  "half-open probe recovers provider to ready on success",
  () => {
    let now = 20_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    health.retryableFailure(
      "anthropic",
      80,
      "TIMEOUT"
    );

    assert.equal(
      health.acquire(
        "anthropic",
        true
      ).allowed,
      false
    );

    now += 1_001;

    const lease =
      health.acquire(
        "anthropic",
        true
      );

    assert.equal(
      lease.allowed,
      true
    );

    assert.equal(
      lease.state,
      "degraded"
    );

    assert.equal(
      lease.circuitState,
      "half-open"
    );

    assert.equal(
      lease.probe,
      true
    );

    health.success(
      "anthropic",
      40
    );

    const snapshot =
      health.snapshot(
        "anthropic",
        true
      );

    assert.equal(
      snapshot.state,
      "ready"
    );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      0
    );

    assert.equal(
      snapshot.successes,
      1
    );

    assert.equal(
      snapshot.failures,
      1
    );

    assert.equal(
      snapshot.successRate,
      0.5
    );

    assert.equal(
      snapshot.lastErrorCode,
      undefined
    );
  }
);

test(
  "only one half-open probe is allowed and retryable probe failure reopens",
  () => {
    let now = 0;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    health.retryableFailure(
      "openai",
      50,
      "TEMP"
    );

    const openSnapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      openSnapshot.nextProbeAt,
      1_000
    );

    now =
      1_001;

    const firstProbe =
      health.acquire(
        "openai",
        true
      );

    const concurrentProbe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      firstProbe.allowed,
      true
    );

    assert.equal(
      firstProbe.probe,
      true
    );

    assert.equal(
      firstProbe.circuitState,
      "half-open"
    );

    assert.equal(
      concurrentProbe.allowed,
      false
    );

    assert.equal(
      concurrentProbe.probe,
      false
    );

    assert.equal(
      concurrentProbe.circuitState,
      "half-open"
    );

    health.failure(
      "openai",
      {
        retryable:
          true,
        latencyMs:
          75,
        errorCode:
          "TEMP_AGAIN"
      }
    );

    const reopened =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      reopened.circuitState,
      "open"
    );

    assert.equal(
      reopened.openedAt,
      now
    );

    assert.equal(
      reopened.nextProbeAt,
      now + 1_000
    );

    assert.equal(
      health.acquire(
        "openai",
        true
      ).allowed,
      false
    );
  }
);

test(
  "abandoned half-open probe reopens with a fresh cooldown",
  () => {
    let now = 30_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    health.retryableFailure(
      "gemini",
      90,
      "TEMP"
    );

    now += 1_001;

    assert.equal(
      health.acquire(
        "gemini",
        true
      ).probe,
      true
    );

    health.release(
      "gemini"
    );

    const snapshot =
      health.snapshot(
        "gemini",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "open"
    );

    assert.equal(
      snapshot.openedAt,
      now
    );

    assert.equal(
      snapshot.nextProbeAt,
      now + 1_000
    );

    assert.equal(
      health.acquire(
        "gemini",
        true
      ).allowed,
      false
    );
  }
);

test(
  "health sample counters remain bounded while preserving a rate",
  () => {
    const health =
      new ProviderHealthRegistry({
        maxSamples:
          10
      });

    for (
      let index = 0;
      index < 30;
      index += 1
    ) {
      if (
        index % 3 ===
        0
      ) {
        health.failure(
          "openai",
          {
            retryable:
              false,
            latencyMs:
              100 + index,
            errorCode:
              "BAD_REQUEST"
          }
        );
      } else {
        health.success(
          "openai",
          100 + index
        );
      }
    }

    const snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.ok(
      snapshot.successes +
      snapshot.failures <=
      10
    );

    assert.ok(
      snapshot.successRate !==
      null
    );

    assert.ok(
      snapshot.successRate! >=
      0
    );

    assert.ok(
      snapshot.successRate! <=
      1
    );

    assert.ok(
      snapshot.averageLatencyMs !==
      null
    );
  }
);

test(
  "automatic routing skips an open provider and uses the next configured provider",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          60_000
      });

    const first =
      new FakeProvider(
        "first",
        async () => {
          throw retryable(
            "FIRST_DOWN"
          );
        }
      );

    const second =
      new FakeProvider(
        "second",
        async () => ({
          text:
            "second-ok",
          provider:
            "second",
          model:
            "second-model",
          usage:
            {}
        })
      );

    const gateway =
      new AiGateway(
        [
          first,
          second
        ],
        "first,second",
        health
      );

    const firstResult =
      await gateway.generate(
        request,
        {
          provider:
            "auto"
        }
      );

    assert.equal(
      firstResult.provider,
      "second"
    );

    assert.equal(
      health.snapshot(
        "first",
        true
      ).state,
      "unavailable"
    );

    const firstCalls =
      first.calls;

    const secondResult =
      await gateway.generate(
        request,
        {
          provider:
            "auto"
        }
      );

    assert.equal(
      secondResult.provider,
      "second"
    );

    assert.equal(
      first.calls,
      firstCalls
    );

    assert.equal(
      second.calls,
      2
    );
  }
);

test(
  "gateway timeout counts as retryable provider failure and falls back",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          60_000
      });

    const first =
      new FakeProvider(
        "first",
        async (
          _input,
          signal
        ) =>
          new Promise<AiResult>(
            (
              _resolve,
              reject
            ) => {
              const fail =
                (): void => {
                  reject(
                    new AiProviderError(
                      "provider observed abort",
                      {
                        code:
                          "FIRST_ABORTED",
                        retryable:
                          false
                      }
                    )
                  );
                };

              if (
                signal.aborted
              ) {
                fail();
                return;
              }

              signal.addEventListener(
                "abort",
                fail,
                {
                  once:
                    true
                }
              );
            }
          )
      );

    const second =
      new FakeProvider(
        "second",
        async () => ({
          text:
            "fallback-ok",
          provider:
            "second",
          model:
            "second-model",
          usage:
            {}
        })
      );

    const gateway =
      new AiGateway(
        [
          first,
          second
        ],
        "first,second",
        health,
        5
      );

    const result =
      await gateway.generate(
        request,
        {
          provider:
            "auto"
        }
      );

    assert.equal(
      result.provider,
      "second"
    );

    assert.equal(
      first.calls,
      1
    );

    assert.equal(
      result.attempts[0]
        ?.status,
      "error"
    );

    assert.equal(
      result.attempts[0]
        ?.errorCode,
      "AI_PROVIDER_TIMEOUT"
    );

    const firstHealth =
      health.snapshot(
        "first",
        true
      );

    assert.equal(
      firstHealth.circuitState,
      "open"
    );

    assert.equal(
      firstHealth.consecutiveFailures,
      1
    );

    assert.equal(
      firstHealth.lastErrorCode,
      "AI_PROVIDER_TIMEOUT"
    );
  }
);

test(
  "client abort remains aborted and does not poison provider health",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1
      });

    const provider =
      new FakeProvider(
        "openai",
        async (
          _input,
          signal
        ) =>
          new Promise<AiResult>(
            (
              _resolve,
              reject
            ) => {
              const fail =
                (): void => {
                  reject(
                    new AiProviderError(
                      "client aborted",
                      {
                        code:
                          "CLIENT_ABORTED",
                        retryable:
                          false
                      }
                    )
                  );
                };

              if (
                signal.aborted
              ) {
                fail();
                return;
              }

              signal.addEventListener(
                "abort",
                fail,
                {
                  once:
                    true
                }
              );
            }
          )
      );

    const gateway =
      new AiGateway(
        [provider],
        "openai",
        health,
        1_000
      );

    const controller =
      new AbortController();

    const pending =
      gateway.generate(
        request,
        {
          provider:
            "openai",
          signal:
            controller.signal
        }
      );

    controller.abort(
      new Error(
        "test client abort"
      )
    );

    await assert.rejects(
      () =>
        pending
    );

    const snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.consecutiveFailures,
      0
    );

    assert.equal(
      snapshot.failures,
      0
    );
  }
);

test(
  "explicit request to open provider fails without another upstream call",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          60_000
      });

    const provider =
      new FakeProvider(
        "openai",
        async () => {
          throw retryable();
        }
      );

    const gateway =
      new AiGateway(
        [provider],
        "openai",
        health
      );

    await assert.rejects(
      () =>
        gateway.generate(
          request,
          {
            provider:
              "openai"
          }
        )
    );

    const calls =
      provider.calls;

    await assert.rejects(
      () =>
        gateway.generate(
          request,
          {
            provider:
              "openai"
          }
        ),
      (
        error:
          unknown
      ) => {
        assert.ok(
          error instanceof
            AiProviderError
        );

        assert.equal(
          error.code,
          "AI_PROVIDER_CIRCUIT_OPEN"
        );

        return true;
      }
    );

    assert.equal(
      provider.calls,
      calls
    );
  }
);

test(
  "gateway health telemetry never stores arbitrary upstream error codes",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          2
      });

    const provider =
      new FakeProvider(
        "custom",
        async () => {
          throw new AiProviderError(
            "upstream rejected request",
            {
              code:
                "secret-looking-upstream-code-12345",
              retryable:
                true
            }
          );
        }
      );

    const gateway =
      new AiGateway(
        [provider],
        "custom",
        health
      );

    await assert.rejects(
      () =>
        gateway.generate(
          request,
          {
            provider:
              "custom"
          }
        )
    );

    const status =
      gateway.status()[0];

    assert.equal(
      status?.health.lastErrorCode,
      "AI_PROVIDER_RETRYABLE_ERROR"
    );

    const serialized =
      JSON.stringify(
        status
      );

    assert.equal(
      serialized.includes(
        "secret-looking-upstream-code-12345"
      ),
      false
    );
  }
);

test(
  "gateway status exposes safe public health and telemetry only",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          2
      });

    const provider =
      new FakeProvider(
        "openai",
        async () => ({
          text:
            "ok",
          provider:
            "openai",
          model:
            "openai-model",
          usage:
            {}
        })
      );

    const gateway =
      new AiGateway(
        [provider],
        "openai",
        health
      );

    await gateway.generate(
      request,
      {
        provider:
          "openai"
      }
    );

    const status =
      gateway.status()[0];

    assert.equal(
      status?.configured,
      true
    );

    assert.equal(
      status?.health.state,
      "ready"
    );

    assert.equal(
      status?.health.circuitState,
      "healthy"
    );

    assert.equal(
      status?.health.successes,
      1
    );

    assert.equal(
      status?.health.failures,
      0
    );

    assert.equal(
      status?.health.successRate,
      1
    );

    const serialized =
      JSON.stringify(
        status
      ).toLowerCase();

    for (
      const forbidden
      of [
        "apikey",
        "authorization",
        "password",
        "prompt",
        "message",
        "content",
        "cookie"
      ]
    ) {
      assert.equal(
        serialized.includes(
          forbidden
        ),
        false
      );
    }
  }
);
