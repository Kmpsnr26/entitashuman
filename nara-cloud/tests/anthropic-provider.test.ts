import test from "node:test";
import assert from "node:assert/strict";

import {
  AnthropicProvider
} from "../src/ai/providers/anthropic.provider.js";

import {
  AiProviderError
} from "../src/ai/types.js";

test(
  "Anthropic generate uses Messages API and server-side x-api-key",
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
            content: [
              {
                type:
                  "text",
                text:
                  "Halo Claude"
              }
            ],

            usage: {
              input_tokens:
                8,
              output_tokens:
                3
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
      new AnthropicProvider({
        apiKey:
          "test-anthropic-key-not-real-123456",

        model:
          "claude-test-model",

        fetchImpl:
          fakeFetch
      });

    const result =
      await provider.generate(
        {
          message:
            "halo",
          history:
            []
        },
        new AbortController()
          .signal
      );

    assert.equal(
      url,
      "https://api.anthropic.com/v1/messages"
    );

    const headers =
      init?.headers as
        Record<string, string>;

    assert.equal(
      headers[
        "x-api-key"
      ],
      "test-anthropic-key-not-real-123456"
    );

    assert.equal(
      headers[
        "anthropic-version"
      ],
      "2023-06-01"
    );

    const body =
      JSON.parse(
        String(
          init?.body
        )
      ) as {
        model: string;
        system: string;
        stream: boolean;
        messages: unknown[];
      };

    assert.equal(
      body.model,
      "claude-test-model"
    );

    assert.equal(
      body.stream,
      false
    );

    assert.match(
      body.system,
      /NARA/
    );

    assert.equal(
      result.text,
      "Halo Claude"
    );

    assert.equal(
      result.usage
        .totalTokens,
      11
    );

    assert.equal(
      JSON.stringify(result)
        .includes(
          "test-anthropic-key"
        ),
      false
    );
  }
);

test(
  "Anthropic SSE stream follows message and content block lifecycle",
  async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
      "",
      'event: content_block_start',
      'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}',
      "",
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Halo "}}',
      "",
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"NARA"}}',
      "",
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":2}}',
      "",
      'event: message_stop',
      'data: {"type":"message_stop"}',
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
      new AnthropicProvider({
        apiKey:
          "test-anthropic-key-not-real-123456",

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
  "Anthropic upstream failures do not expose raw error detail",
  async () => {
    const fakeFetch =
      (async () =>
        new Response(
          JSON.stringify({
            error: {
              type:
                "rate_limit_error",
              message:
                "private detail"
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
      new AnthropicProvider({
        apiKey:
          "test-anthropic-key-not-real-123456",

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
          "ANTHROPIC_UPSTREAM_ERROR"
        );

        assert.equal(
          error.code.includes(
            "rate_limit_error"
          ),
          false
        );

        assert.equal(
          error.retryable,
          true
        );

        assert.equal(
          error.message.includes(
            "private detail"
          ),
          false
        );

        return true;
      }
    );
  }
);
