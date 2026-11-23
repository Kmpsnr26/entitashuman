import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenAiProvider
} from "../src/ai/providers/openai.provider.js";

import {
  AiProviderError
} from "../src/ai/types.js";

test(
  "OpenAI provider keeps credentials in headers and disables response storage",
  async () => {
    let capturedUrl = "";
    let capturedInit:
      RequestInit |
      undefined;

    const fakeFetch =
      (async (
        input:
          string |
          URL |
          Request,
        init?:
          RequestInit
      ) => {
        capturedUrl =
          String(input);

        capturedInit =
          init;

        return new Response(
          JSON.stringify({
            output_text:
              "Halo dari NARA",

            usage: {
              input_tokens:
                10,
              output_tokens:
                4,
              total_tokens:
                14
            }
          }),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json"
            }
          }
        );
      }) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        model:
          "test-model",

        fetchImpl:
          fakeFetch
      });

    const result =
      await provider.generate(
        {
          message:
            "halo",

          history: [
            {
              role:
                "assistant",
              content:
                "siap"
            }
          ]
        },
        new AbortController()
          .signal
      );

    assert.equal(
      capturedUrl,
      "https://api.openai.com/v1/responses"
    );

    const headers =
      capturedInit
        ?.headers as
        Record<string, string>;

    assert.equal(
      headers.Authorization,
      "Bearer test-openai-key-not-real-123456"
    );

    const body =
      JSON.parse(
        String(
          capturedInit?.body
        )
      ) as {
        model: string;
        store: boolean;
        stream: boolean;
        instructions: string;
        input: unknown[];
        tools?: unknown;
      };

    assert.equal(
      body.model,
      "test-model"
    );

    assert.equal(
      body.store,
      false
    );

    assert.equal(
      body.stream,
      false
    );

    assert.equal(
      body.input.length,
      2
    );

    assert.equal(
      Object.hasOwn(
        body,
        "tools"
      ),
      false
    );

    assert.match(
      body.instructions,
      /AleCore AI/
    );

    assert.equal(
      result.text,
      "Halo dari NARA"
    );

    assert.equal(
      JSON.stringify(result)
        .includes(
          "test-openai-key"
        ),
      false
    );
  }
);

test(
  "OpenAI streaming emits deltas and requires a completed event",
  async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Halo "}',
      "",
      'data: {"type":"response.output_text.delta","delta":"NARA"}',
      "",
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");

    const fakeFetch =
      (async () =>
        new Response(
          streamBody,
          {
            status: 200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        model:
          "test-model",

        fetchImpl:
          fakeFetch
      });

    const deltas:
      string[] = [];

    const completed =
      await provider.stream(
        {
          message:
            "halo",
          history:
            []
        },
        new AbortController()
          .signal,
        delta => {
          deltas.push(delta);
        }
      );

    assert.deepEqual(
      deltas,
      [
        "Halo ",
        "NARA"
      ]
    );

    assert.equal(
      completed.usage
        .totalTokens,
      7
    );
  }
);

test(
  "OpenAI empty successful response is non-retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify(
            {
            output_text:
              ""
          }
          ),
          {
            status:
              200,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.generate(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal
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
          "OPENAI_EMPTY_RESPONSE"
        );

        assert.equal(
          error.retryable,
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI non-stream incomplete response is rejected as non-retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            status:
              "incomplete",
            incomplete_details: {
              reason:
                "max_output_tokens"
            },
            output_text:
              "partial text"
          }),
          {
            status:
              200,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.generate(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal
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
          "OPENAI_RESPONSE_INCOMPLETE"
        );

        assert.equal(
          error.retryable,
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI explicit response.incomplete stream event is non-retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          [
            'event: response.incomplete',
            'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
            "",
            ""
          ].join("\n"),
          {
            status:
              200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.stream(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal,
          () => {}
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
          "OPENAI_STREAM_INCOMPLETE"
        );

        assert.equal(
          error.retryable,
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI incomplete stream is rejected as retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          {
            status: 200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.stream(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal,
          () => {}
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
          "OPENAI_STREAM_INCOMPLETE"
        );

        assert.equal(
          error.retryable,
          true
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI upstream 429 is classified retryable without returning raw upstream text",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              code:
                "rate_limit_exceeded",
              message:
                "sensitive upstream detail"
            }
          }),
          {
            status: 429,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.generate(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal
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
          "OPENAI_UPSTREAM_ERROR"
        );

        assert.equal(
          error.code.includes(
            "rate_limit_exceeded"
          ),
          false
        );

        assert.equal(
          error.retryable,
          true
        );

        assert.equal(
          error.message.includes(
            "sensitive upstream detail"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI account-limit 429 is non-retryable without exposing upstream code",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              code:
                "credit_balance_exhausted",
              message:
                "private billing detail"
            }
          }),
          {
            status:
              429,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.generate(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal
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
          "OPENAI_UPSTREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          false
        );

        assert.equal(
          error.message.includes(
            "credit_balance_exhausted"
          ),
          false
        );

        assert.equal(
          error.message.includes(
            "private billing detail"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI insufficient_quota type is non-retryable when code is absent",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              type:
                "insufficient_quota",
              message:
                "private quota detail"
            }
          }),
          {
            status:
              429,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiProvider({
        apiKey:
          "test-openai-key-not-real-123456",

        fetchImpl:
          fakeFetch
      });

    await assert.rejects(
      () =>
        provider.generate(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal
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
          "OPENAI_UPSTREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          false
        );

        assert.equal(
          error.message.includes(
            "private quota detail"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "OpenAI stream retryability only trusts known transient codes",
  async () => {
    const providerFor =
      (
        code: string
      ): OpenAiProvider =>
        new OpenAiProvider({
          apiKey:
            "test-openai-key-not-real-123456",

          fetchImpl:
            (async () =>
              new Response(
                [
                  "event: error",
                  `data: {"type":"error","error":{"code":"${code}"}}`,
                  "",
                  ""
                ].join("\n"),
                {
                  status:
                    200,
                  headers: {
                    "content-type":
                      "text/event-stream"
                  }
                }
              )) as typeof fetch
        });

    await assert.rejects(
      () =>
        providerFor(
          "server_is_overloaded"
        ).stream(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal,
          () => {}
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
          "OPENAI_STREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          true
        );

        return true;
      }
    );

    await assert.rejects(
      () =>
        providerFor(
          "AI_PROVIDER_CIRCUIT_OPEN"
        ).stream(
          {
            message:
              "halo",
            history:
              []
          },
          new AbortController()
            .signal,
          () => {}
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
          "OPENAI_STREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          false
        );

        return true;
      }
    );
  }
);
