import test from "node:test";
import assert from "node:assert/strict";

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
  message:
    "Halo AleCore AI",

  history: []
};

class FakeProvider
  implements AiProvider {

  readonly id: string;
  readonly model: string;

  private readonly generateImpl:
    (
      request: AiRequest,
      signal: AbortSignal
    ) =>
      Promise<AiResult>;

  private readonly streamImpl:
    (
      request: AiRequest,
      signal: AbortSignal,
      onDelta:
        (
          delta: string
        ) =>
          void |
          Promise<void>
    ) =>
      Promise<AiStreamCompleted>;

  constructor(
    options: {
      id: string;
      generate:
        FakeProvider[
          "generateImpl"
        ];
      stream:
        FakeProvider[
          "streamImpl"
        ];
    }
  ) {
    this.id =
      options.id;

    this.model =
      options.id +
      "-model";

    this.generateImpl =
      options.generate;

    this.streamImpl =
      options.stream;
  }

  configured(): boolean {
    return true;
  }

  generate(
    input: AiRequest,
    signal: AbortSignal
  ): Promise<AiResult> {
    return this.generateImpl(
      input,
      signal
    );
  }

  stream(
    input: AiRequest,
    signal: AbortSignal,
    onDelta:
      (
        delta: string
      ) =>
        void |
        Promise<void>
  ): Promise<AiStreamCompleted> {
    return this.streamImpl(
      input,
      signal,
      onDelta
    );
  }
}

function successProvider(
  id: string,
  text = "OK"
): FakeProvider {
  return new FakeProvider({
    id,

    async generate() {
      return {
        text,
        provider: id,
        model:
          id + "-model",
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3
        }
      };
    },

    async stream(
      _input,
      _signal,
      onDelta
    ) {
      await onDelta(text);

      return {
        provider: id,
        model:
          id + "-model",
        usage: {
          outputTokens: 1
        }
      };
    }
  });
}

function retryableFailure(
  id: string,
  options: {
    emitBeforeFail?:
      boolean;
  } = {}
): FakeProvider {
  return new FakeProvider({
    id,

    async generate() {
      throw new AiProviderError(
        "temporary",
        {
          code:
            "TEMPORARY",
          retryable:
            true
        }
      );
    },

    async stream(
      _input,
      _signal,
      onDelta
    ) {
      if (
        options.emitBeforeFail
      ) {
        await onDelta(
          "partial"
        );
      }

      throw new AiProviderError(
        "temporary",
        {
          code:
            "TEMPORARY",
          retryable:
            true
        }
      );
    }
  });
}

test(
  "auto gateway falls back after a retryable pre-output failure",
  async () => {
    const gateway =
      new AiGateway(
        [
          retryableFailure(
            "first"
          ),
          successProvider(
            "second",
            "jawaban"
          )
        ],
        "first,second"
      );

    const attempts:
      string[] = [];

    const result =
      await gateway.generate(
        request,
        {
          provider:
            "auto",

          onAttempt:
            attempt => {
              attempts.push(
                attempt.provider +
                ":" +
                attempt.status
              );
            }
        }
      );

    assert.equal(
      result.provider,
      "second"
    );

    assert.equal(
      result.text,
      "jawaban"
    );

    assert.deepEqual(
      attempts,
      [
        "first:error",
        "second:success"
      ]
    );

    assert.equal(
      result.attempts
        .length,
      2
    );

    assert.equal(
      result.attempts[1]
        ?.fallbackFrom,
      "first"
    );
  }
);

test(
  "pinned provider does not fall back",
  async () => {
    const gateway =
      new AiGateway(
        [
          retryableFailure(
            "first"
          ),
          successProvider(
            "second"
          )
        ],
        "first,second"
      );

    await assert.rejects(
      () =>
        gateway.generate(
          request,
          {
            provider:
              "first"
          }
        ),
      /temporary/
    );
  }
);

test(
  "stream falls back only before first delta",
  async () => {
    const gateway =
      new AiGateway(
        [
          retryableFailure(
            "first"
          ),
          successProvider(
            "second",
            "final"
          )
        ],
        "first,second"
      );

    const deltas:
      string[] = [];

    const providers:
      string[] = [];

    const result =
      await gateway.stream(
        request,
        {
          provider:
            "auto",

          onProvider:
            provider => {
              providers.push(
                provider.id
              );
            },

          onDelta:
            delta => {
              deltas.push(delta);
            }
        }
      );

    assert.deepEqual(
      providers,
      ["second"]
    );

    assert.deepEqual(
      deltas,
      ["final"]
    );

    assert.equal(
      result.completed
        .provider,
      "second"
    );
  }
);

test(
  "stream never mixes a fallback provider after text has already been emitted",
  async () => {
    let secondCalled =
      false;

    const second =
      new FakeProvider({
        id:
          "second",

        async generate() {
          secondCalled =
            true;

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
          secondCalled =
            true;

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
      });

    const gateway =
      new AiGateway(
        [
          retryableFailure(
            "first",
            {
              emitBeforeFail:
                true
            }
          ),
          second
        ],
        "first,second"
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
      /temporary/
    );

    assert.deepEqual(
      deltas,
      ["partial"]
    );

    assert.equal(
      secondCalled,
      false
    );
  }
);
