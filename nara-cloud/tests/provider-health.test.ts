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

class FakeProvider
  implements AiProvider {

  readonly id: string;
  readonly model: string;

  calls = 0;

  private readonly impl:
    () => Promise<AiResult>;

  constructor(
    id: string,
    impl:
      () => Promise<AiResult>
  ) {
    this.id = id;
    this.model =
      id + "-model";
    this.impl = impl;
  }

  configured(): boolean {
    return true;
  }

  async generate(
    _request: AiRequest,
    _signal: AbortSignal
  ): Promise<AiResult> {
    this.calls += 1;
    return this.impl();
  }

  async stream(
    _request: AiRequest,
    _signal: AbortSignal,
    onDelta:
      (
        delta: string
      ) =>
        void |
        Promise<void>
  ): Promise<AiStreamCompleted> {
    this.calls += 1;

    const result =
      await this.impl();

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

const request: AiRequest = {
  message:
    "halo",
  history:
    []
};

function retryableFailure(
  id: string
): AiProviderError {
  return new AiProviderError(
    id + " unavailable",
    {
      code:
        id.toUpperCase() +
        "_TEMPORARY",
      retryable:
        true
    }
  );
}

test(
  "provider health opens after threshold and allows one half-open probe after cooldown",
  () => {
    let now = 1_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          2,

        cooldownMs:
          5_000,

        now:
          () => now
      });

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).state,
      "healthy"
    );

    health.retryableFailure(
      "openai"
    );

    assert.equal(
      health.snapshot(
        "openai",
        true
      ).state,
      "degraded"
    );

    health.retryableFailure(
      "openai"
    );

    let snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "open"
    );

    assert.equal(
      snapshot
        .consecutiveFailures,
      2
    );

    assert.equal(
      health.acquire(
        "openai",
        true
      ).allowed,
      false
    );

    now += 5_000;

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
      probe.state,
      "half-open"
    );

    assert.equal(
      probe.probe,
      true
    );

    assert.equal(
      health.acquire(
        "openai",
        true
      ).allowed,
      false
    );

    health.success(
      "openai"
    );

    snapshot =
      health.snapshot(
        "openai",
        true
      );

    assert.equal(
      snapshot.state,
      "healthy"
    );

    assert.equal(
      snapshot
        .consecutiveFailures,
      0
    );
  }
);

test(
  "failed half-open probe reopens circuit",
  () => {
    let now = 10_000;

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
      "gemini"
    );

    now += 1_000;

    assert.equal(
      health.acquire(
        "gemini",
        true
      ).state,
      "half-open"
    );

    health.retryableFailure(
      "gemini"
    );

    const snapshot =
      health.snapshot(
        "gemini",
        true
      );

    assert.equal(
      snapshot.state,
      "open"
    );

    assert.equal(
      snapshot.openedAt,
      now
    );
  }
);

test(
  "unconfigured provider reports unavailable without creating breaker failures",
  () => {
    const health =
      new ProviderHealthRegistry();

    const lease =
      health.acquire(
        "anthropic",
        false
      );

    assert.equal(
      lease.allowed,
      false
    );

    assert.equal(
      lease.state,
      "unavailable"
    );

    assert.equal(
      health.snapshot(
        "anthropic",
        false
      )
        .consecutiveFailures,
      0
    );
  }
);

test(
  "auto routing skips an open provider and uses next healthy provider",
  async () => {
    let now = 1_000;

    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          1,

        cooldownMs:
          60_000,

        now:
          () => now
      });

    const first =
      new FakeProvider(
        "first",
        async () => {
          throw retryableFailure(
            "first"
          );
        }
      );

    const second =
      new FakeProvider(
        "second",
        async () => ({
          text:
            "OK",
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
      "open"
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

    now += 1;
  }
);

test(
  "explicit request to open provider fails safely without calling it again",
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
          throw retryableFailure(
            "openai"
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

        assert.equal(
          error.retryable,
          false
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
  "provider status contains safe health metadata only",
  () => {
    const health =
      new ProviderHealthRegistry({
        failureThreshold:
          2,
        cooldownMs:
          5_000,
        now:
          () => 123_000
      });

    health.retryableFailure(
      "openai"
    );

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

    const status =
      gateway.status()[0];

    assert.equal(
      status?.configured,
      true
    );

    assert.equal(
      status?.health.state,
      "degraded"
    );

    const serialized =
      JSON.stringify(
        status
      );

    for (
      const forbidden
      of [
        "apiKey",
        "authorization",
        "password",
        "prompt",
        "message",
        "content"
      ]
    ) {
      assert.equal(
        serialized
          .toLowerCase()
          .includes(
            forbidden
              .toLowerCase()
          ),
        false
      );
    }
  }
);
