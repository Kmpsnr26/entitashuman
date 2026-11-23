import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenAiCompatibleProvider
} from "../src/ai/providers/openai-compatible.provider.js";

import {
  AiProviderError
} from "../src/ai/types.js";

test(
  "compatible provider base URL and credentials are server configured",
  async () => {
    let url = "";
    let init:
      RequestInit |
      undefined;

    const fakeFetch =
      (async (
        input,
        options
      ) => {
        url =
          String(input);

        init =
          options;

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Compatible OK"
                }
              }
            ],

            usage: {
              prompt_tokens:
                6,
              completion_tokens:
                2,
              total_tokens:
                8
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
      new OpenAiCompatibleProvider({
        id:
          "custom",

        baseUrl:
          "https://provider.example/v1/",

        apiKey:
          "test-compatible-key-not-real",

        model:
          "custom-model",

        fetchImpl:
          fakeFetch
      });

    const result =
      await provider.generate(
        {
          message:
            "halo",

          history: []
        },
        new AbortController()
          .signal
      );

    assert.equal(
      url,
      "https://provider.example/v1/chat/completions"
    );

    const headers =
      init?.headers as
        Record<string, string>;

    assert.equal(
      headers.Authorization,
      "Bearer test-compatible-key-not-real"
    );

    const body =
      JSON.parse(
        String(
          init?.body
        )
      ) as {
        model: string;
        messages: Array<{
          role: string;
          content: string;
        }>;
      };

    assert.equal(
      body.model,
      "custom-model"
    );

    assert.equal(
      body.messages[0]?.role,
      "system"
    );

    assert.equal(
      result.provider,
      "custom"
    );

    assert.equal(
      result.usage
        .totalTokens,
      8
    );

    assert.equal(
      JSON.stringify(result)
        .includes(
          "test-compatible-key"
        ),
      false
    );
  }
);

test(
  "compatible empty successful response is non-retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify(
            {
            choices: [
              {
                message: {
                  content:
                    ""
                }
              }
            ]
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
      new OpenAiCompatibleProvider({
        id:
          "custom",
        baseUrl:
          "https://provider.example/v1",
        model:
          "custom-model",
        apiKey:
          "test-compatible-key-not-real",

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
          "COMPAT_EMPTY_RESPONSE"
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
  "compatible provider SSE completes only after DONE marker",
  async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Halo "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"AleCore AI"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");

    const fakeFetch =
      (async () =>
        new Response(
          sse,
          {
            status: 200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const provider =
      new OpenAiCompatibleProvider({
        id:
          "custom",

        baseUrl:
          "https://provider.example/v1",

        apiKey:
          "test-compatible-key-not-real",

        model:
          "custom-model",

        fetchImpl:
          fakeFetch
      });

    const chunks:
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
          chunks.push(delta);
        }
      );

    assert.deepEqual(
      chunks,
      [
        "Halo ",
        "AleCore AI"
      ]
    );

    assert.equal(
      completed.usage
        .totalTokens,
      6
    );
  }
);

test(
  "compatible provider never trusts upstream error codes",
  async () => {
    const fakeHttpFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              code:
                "AI_PROVIDER_CIRCUIT_OPEN",
              type:
                "secret-looking-code"
            }
          }),
          {
            status:
              503,
            headers: {
              "content-type":
                "application/json"
            }
          }
        )) as typeof fetch;

    const httpProvider =
      new OpenAiCompatibleProvider({
        id:
          "custom",
        baseUrl:
          "https://provider.example/v1",
        apiKey:
          "test-compatible-key-not-real",
        model:
          "custom-model",
        fetchImpl:
          fakeHttpFetch
      });

    await assert.rejects(
      () =>
        httpProvider.generate(
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
          "COMPAT_UPSTREAM_ERROR"
        );

        return true;
      }
    );

    const sse = [
      'data: {"error":{"code":"AI_PROVIDER_CIRCUIT_OPEN","type":"secret-looking-code"}}',
      "",
      ""
    ].join("\n");

    const fakeStreamFetch =
      (async () =>
        new Response(
          sse,
          {
            status:
              200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const streamProvider =
      new OpenAiCompatibleProvider({
        id:
          "custom",
        baseUrl:
          "https://provider.example/v1",
        apiKey:
          "test-compatible-key-not-real",
        model:
          "custom-model",
        fetchImpl:
          fakeStreamFetch
      });

    await assert.rejects(
      () =>
        streamProvider.stream(
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
          "COMPAT_STREAM_ERROR"
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
  "compatible stream retryability only trusts known transient codes",
  async () => {
    const sse = [
      'data: {"error":{"code":"server_is_overloaded"}}',
      "",
      ""
    ].join("\n");

    const provider =
      new OpenAiCompatibleProvider({
        id:
          "custom",
        baseUrl:
          "https://provider.example/v1",
        apiKey:
          "test-compatible-key-not-real",
        model:
          "custom-model",
        fetchImpl:
          (async () =>
            new Response(
              sse,
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
          "COMPAT_STREAM_ERROR"
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
