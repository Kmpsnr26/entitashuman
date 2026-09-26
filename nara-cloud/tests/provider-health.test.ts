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
      "AI_PROVIDER_RETRYABLE_ERROR"
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
          "REQUEST_SPECIFIC",
        probeId:
          probe.probeId
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
      40,
      lease.probeId
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
          "TEMP_AGAIN",
        probeId:
          firstProbe.probeId
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
  "stale in-flight completions cannot override the active half-open probe",
  () => {
    let now = 40_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    const staleLease =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      staleLease.probe,
      false
    );

    health.retryableFailure(
      "openai",
      25,
      "AI_PROVIDER_RETRYABLE_ERROR"
    );

    now += 1_001;

    const activeProbe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      activeProbe.probe,
      true
    );

    health.success(
      "openai",
      30,
      staleLease.probeId
    );

    let snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "half-open"
    );

    assert.equal(
      snapshot.probeInFlight,
      true
    );

    health.failure(
      "openai",
      {
        retryable:
          true,
        latencyMs:
          35,
        errorCode:
          "AI_PROVIDER_RETRYABLE_ERROR",
        probeId:
          staleLease.probeId
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
      snapshot.probeInFlight,
      true
    );

    health.success(
      "openai",
      20,
      activeProbe.probeId
    );

    snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.probeInFlight,
      false
    );
  }
);

test(
  "half-open status does not advertise an already elapsed next probe time",
  () => {
    let now =
      80_000;

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
      10,
      "AI_PROVIDER_RETRYABLE_ERROR"
    );

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).nextProbeAt,
      now + 1_000
    );

    now +=
      1_001;

    const probe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      probe.circuitState,
      "half-open"
    );

    const snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.nextProbeAt,
      undefined
    );

    health.release(
      "openai",
      probe.probeId
    );

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).nextProbeAt,
      undefined
    );
  }
);

test(
  "stale released probe cannot close a newer half-open probe",
  () => {
    let now = 50_000;

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
      20,
      "AI_PROVIDER_RETRYABLE_ERROR"
    );

    now += 1_001;

    const oldProbe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      oldProbe.probe,
      true
    );

    health.release(
      "openai",
      oldProbe.probeId
    );

    const newProbe =
      health.acquire(
        "openai",
        true
      );

    assert.equal(
      newProbe.probe,
      true
    );

    assert.notEqual(
      oldProbe.probeId,
      newProbe.probeId
    );

    health.success(
      "openai",
      15,
      oldProbe.probeId
    );

    let snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "half-open"
    );

    assert.equal(
      snapshot.probeInFlight,
      true
    );

    health.success(
      "openai",
      10,
      newProbe.probeId
    );

    snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.probeInFlight,
      false
    );
  }
);

test(
  "abandoned half-open probe releases its lease without poisoning provider health",
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

    const openedAt =
      health.snapshot(
        "gemini",
        true
      ).openedAt;

    now += 1_001;

    const lease =
      health.acquire(
        "gemini",
        true
      );

    assert.equal(
      lease.probe,
      true
    );

    health.release(
      "gemini",
      lease.probeId
    );

    const snapshot =
      health.snapshot(
        "gemini",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "half-open"
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
        "gemini",
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

    assert.equal(
      nextProbe.circuitState,
      "half-open"
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
  "attempt observer failure does not fail a successful provider request",
  async () => {
    const health =
      new ProviderHealthRegistry();

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

    const result =
      await gateway.generate(
        request,
        {
          provider:
            "openai",

          onAttempt:
            () => {
              throw new Error(
                "observer failed"
              );
            }
        }
      );

    assert.equal(
      result.text,
      "ok"
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
      snapshot.successes,
      1
    );

    assert.equal(
      snapshot.failures,
      0
    );
  }
);

test(
  "downstream stream callback failure does not poison provider health or fallback",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1
      });

    const first =
      new FakeProvider(
        "first",
        async () => ({
          text:
            "first-delta",
          provider:
            "first",
          model:
            "first-model",
          usage:
            {}
        })
      );

    const second =
      new FakeProvider(
        "second",
        async () => ({
          text:
            "second-delta",
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

    const downstreamError =
      new Error(
        "client output failed"
      );

    await assert.rejects(
      () =>
        gateway.stream(
          request,
          {
            provider:
              "auto",

            onProvider:
              () => {},

            onDelta:
              () => {
                throw downstreamError;
              }
          }
        ),
      error =>
        error ===
        downstreamError
    );

    assert.equal(
      first.calls,
      1
    );

    assert.equal(
      second.calls,
      0
    );

    const snapshot =
      health.snapshot(
        "first",
        true
      );

    assert.equal(
      snapshot.circuitState,
      "healthy"
    );

    assert.equal(
      snapshot.failures,
      0
    );

    assert.equal(
      snapshot.consecutiveFailures,
      0
    );
  }
);

test(
  "gateway successful half-open probe closes the circuit",
  async () => {
    let now = 60_000;
    let shouldFail =
      true;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          1_000,
        now:
          () => now
      });

    const provider =
      new FakeProvider(
        "openai",
        async () => {
          if (shouldFail) {
            throw retryable(
              "TEMP"
            );
          }

          return {
            text:
              "recovered",
            provider:
              "openai",
            model:
              "openai-model",
            usage:
              {}
          };
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

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).circuitState,
      "open"
    );

    now += 1_001;
    shouldFail =
      false;

    const result =
      await gateway.generate(
        request,
        {
          provider:
            "openai"
        }
      );

    assert.equal(
      result.text,
      "recovered"
    );

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).circuitState,
      "healthy"
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
  "stream timeout records provider failure and falls back before any delta",
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
            "stream-fallback",
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

    const deltas:
      string[] = [];

    const result =
      await gateway.stream(
        request,
        {
          provider:
            "auto",

          onProvider:
            () => {},

          onDelta:
            delta => {
              deltas.push(
                delta
              );
            }
        }
      );

    assert.equal(
      result.completed.provider,
      "second"
    );

    assert.deepEqual(
      deltas,
      [
        "stream-fallback"
      ]
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
      firstHealth.lastErrorCode,
      "AI_PROVIDER_TIMEOUT"
    );
  }
);

test(
  "stream timeout after first delta never mixes a fallback provider",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,
        cooldownMs:
          60_000
      });

    let firstCalls =
      0;
    let secondCalls =
      0;

    const first:
      AiProvider = {
        id:
          "first",

        model:
          "first-model",

        configured:
          () => true,

        async generate() {
          throw new Error(
            "generate not used"
          );
        },

        async stream(
          _input,
          signal,
          onDelta
        ) {
          firstCalls +=
            1;

          await onDelta(
            "partial"
          );

          await new Promise<void>(
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
          );

          return {
            provider:
              "first",
            model:
              "first-model",
            usage:
              {}
          };
        }
      };

    const second:
      AiProvider = {
        id:
          "second",

        model:
          "second-model",

        configured:
          () => true,

        async generate() {
          secondCalls +=
            1;

          return {
            text:
              "second",
            provider:
              "second",
            model:
              "second-model",
            usage:
              {}
          };
        },

        async stream(
          _input,
          _signal,
          onDelta
        ) {
          secondCalls +=
            1;

          await onDelta(
            "second"
          );

          return {
            provider:
              "second",
            model:
              "second-model",
            usage:
              {}
          };
        }
      };

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

    const deltas:
      string[] = [];

    await assert.rejects(
      () =>
        gateway.stream(
          request,
          {
            provider:
              "auto",

            onProvider:
              () => {},

            onDelta:
              delta => {
                deltas.push(
                  delta
                );
              }
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
          "AI_PROVIDER_TIMEOUT"
        );

        return true;
      }
    );

    assert.deepEqual(
      deltas,
      [
        "partial"
      ]
    );

    assert.equal(
      firstCalls,
      1
    );

    assert.equal(
      secondCalls,
      0
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
      firstHealth.lastErrorCode,
      "AI_PROVIDER_TIMEOUT"
    );
  }
);

test(
  "automatic routing skips a provider with an active half-open probe",
  async () => {
    let now =
      70_000;

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
      "first",
      10,
      "AI_PROVIDER_RETRYABLE_ERROR"
    );

    now +=
      1_001;

    const activeProbe =
      health.acquire(
        "first",
        true
      );

    assert.equal(
      activeProbe.probe,
      true
    );

    const first =
      new FakeProvider(
        "first",
        async () => ({
          text:
            "first",
          provider:
            "first",
          model:
            "first-model",
          usage:
            {}
        })
      );

    const second =
      new FakeProvider(
        "second",
        async () => ({
          text:
            "second",
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
      0
    );

    assert.equal(
      second.calls,
      1
    );

    assert.equal(
      health.snapshot(
        "first",
        true
      ).probeInFlight,
      true
    );

    health.release(
      "first",
      activeProbe.probeId
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
  "non-retryable upstream 429 is reported as a limit without poisoning breaker health",
  async () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1
      });

    const provider =
      new FakeProvider(
        "openai",
        async () => {
          throw new AiProviderError(
            "account limit",
            {
              code:
                "OPENAI_UPSTREAM_ERROR",
              retryable:
                false,
              httpStatus:
                429
            }
          );
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
      1
    );

    assert.equal(
      snapshot.lastErrorCode,
      "AI_UPSTREAM_LIMIT_REACHED"
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
        "cookie",
        "activeprobeid",
        "probesequence"
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
