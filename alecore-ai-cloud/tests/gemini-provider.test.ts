import test from "node:test";
import assert from "node:assert/strict";

import {
  GeminiProvider
} from "../src/ai/providers/gemini.provider.js";

import {
  AiProviderError
} from "../src/ai/types.js";

test(
  "Gemini generate uses server-side API key and documented generateContent endpoint",
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
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text:
                        "Halo Gemini"
                    }
                  ]
                }
              }
            ],

            usageMetadata: {
              promptTokenCount:
                7,
              candidatesTokenCount:
                3,
              totalTokenCount:
                10
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
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

        model:
          "gemini-test-model",

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

    assert.match(
      url,
      /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test-model:generateContent$/
    );

    const headers =
      init?.headers as
        Record<string, string>;

    assert.equal(
      headers[
        "x-goog-api-key"
      ],
      "test-gemini-key-not-real-123456"
    );

    const body =
      JSON.parse(
        String(
          init?.body
        )
      ) as Record<
        string,
        unknown
      >;

    assert.ok(
      body.systemInstruction
    );

    assert.ok(
      body.generationConfig
    );

    assert.equal(
      Object.hasOwn(
        body,
        "store"
      ),
      false
    );

    assert.equal(
      result.text,
      "Halo Gemini"
    );

    assert.equal(
      result.usage
        .totalTokens,
      10
    );

    assert.equal(
      JSON.stringify(result)
        .includes(
          "test-gemini-key"
        ),
      false
    );
  }
);

test(
  "Gemini empty successful response is non-retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify(
            {
            candidates:
              []
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
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

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
          "GEMINI_EMPTY_RESPONSE"
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
  "Gemini SSE stream emits chunks and requires finishReason",
  async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Halo "}]}}]}',
      "",
      'data: {"candidates":[{"content":{"parts":[{"text":"AleCore AI"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}',
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
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

        model:
          "gemini-test-model",

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
  "Gemini incomplete stream is retryable",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n',
          {
            status: 200,
            headers: {
              "content-type":
                "text/event-stream"
            }
          }
        )) as typeof fetch;

    const provider =
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

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
          "GEMINI_STREAM_INCOMPLETE"
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
  "Gemini HTTP errors never copy upstream error codes",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              status:
                "AI_PROVIDER_CIRCUIT_OPEN",
              code:
                "secret-looking-code",
              message:
                "private upstream detail"
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
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

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
          "GEMINI_UPSTREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          true
        );

        assert.equal(
          error.message.includes(
            "private upstream detail"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "Gemini stream retryability only trusts transient statuses",
  async () => {
    const providerFor =
      (
        status: string
      ): GeminiProvider =>
        new GeminiProvider({
          apiKey:
            "test-gemini-key-not-real-123456",

          fetchImpl:
            (async () =>
              new Response(
                [
                  `data: {"error":{"code":503,"status":"${status}"}}`,
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
          "UNAVAILABLE"
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
          "GEMINI_STREAM_ERROR"
        );

        assert.equal(
          error.retryable,
          true
        );

        return true;
      }
    );

    const unknownProvider =
      new GeminiProvider({
        apiKey:
          "test-gemini-key-not-real-123456",

        fetchImpl:
          (async () =>
            new Response(
              [
                'data: {"error":{"code":400,"status":"AI_PROVIDER_CIRCUIT_OPEN"}}',
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
        unknownProvider.stream(
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
          error.retryable,
          false
        );

        return true;
      }
    );
  }
);
