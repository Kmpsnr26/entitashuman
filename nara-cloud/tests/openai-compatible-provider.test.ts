import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenAiCompatibleProvider
} from "../src/ai/providers/openai-compatible.provider.js";

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
  "compatible provider SSE completes only after DONE marker",
  async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Halo "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"NARA"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
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
        "NARA"
      ]
    );

    assert.equal(
      completed.usage
        .totalTokens,
      6
    );
  }
);
