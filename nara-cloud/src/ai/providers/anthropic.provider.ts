import { env } from "../../config/env.js";

import {
  AiProviderError,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiStreamCompleted
} from "../types.js";

import {
  parseSse
} from "../sse-parser.js";

import {
  NARA_SYSTEM_PROMPT
} from "../systemPrompt.js";

type FetchLike =
  typeof fetch;

interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;

  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };

  error?: {
    type?: string;
  };
}

function requestBody(
  request: AiRequest,
  stream: boolean
): Record<string, unknown> {
  return {
    model:
      env.ANTHROPIC_MODEL,

    max_tokens:
      env.AI_MAX_OUTPUT_TOKENS,

    system:
      NARA_SYSTEM_PROMPT,

    messages: [
      ...request.history.map(
        item => ({
          role:
            item.role,

          content:
            item.content
        })
      ),

      {
        role:
          "user",

        content:
          request.message
      }
    ],

    stream
  };
}

function textFrom(
  response:
    AnthropicResponse
): string {
  return (
    response.content ?? []
  )
    .filter(
      item =>
        item.type ===
        "text" &&
        typeof item.text ===
        "string"
    )
    .map(
      item =>
        item.text!
    )
    .join("");
}

function usageFrom(
  usage:
    AnthropicResponse[
      "usage"
    ]
) {
  const input =
    usage?.input_tokens;

  const output =
    usage?.output_tokens;

  return {
    inputTokens:
      input,

    outputTokens:
      output,

    totalTokens:
      typeof input ===
        "number" &&
      typeof output ===
        "number"
        ? input + output
        : undefined
  };
}

const ANTHROPIC_RETRYABLE_STREAM_TYPES =
  new Set([
    "rate_limit_error",
    "api_error",
    "timeout_error",
    "overloaded_error",
    "conflict_error"
  ]);

function isRetryableStreamError(
  value: unknown
): boolean {
  return (
    typeof value ===
      "string" &&
    ANTHROPIC_RETRYABLE_STREAM_TYPES
      .has(
        value
          .trim()
          .toLowerCase()
      )
  );
}

async function failureFrom(
  response: Response
): Promise<AiProviderError> {
  const retryable429 =
    response.status ===
      429 &&
    Boolean(
      response.headers.get(
        "retry-after"
      )
    );

  const retryable =
    response.status === 408 ||
    response.status === 409 ||
    retryable429 ||
    response.status >= 500;

  return new AiProviderError(
    "Anthropic provider request failed.",
    {
      code:
        "ANTHROPIC_UPSTREAM_ERROR",
      retryable,
      httpStatus:
        response.status
    }
  );
}

export class AnthropicProvider
  implements AiProvider {

  readonly id =
    "anthropic";

  private readonly apiKey:
    string |
    undefined;

  private readonly modelName:
    string;

  private readonly fetchImpl:
    FetchLike;

  constructor(
    options:
      AnthropicProviderOptions = {}
  ) {
    this.apiKey =
      options.apiKey ??
      env.ANTHROPIC_API_KEY;

    this.modelName =
      options.model ??
      env.ANTHROPIC_MODEL;

    this.fetchImpl =
      options.fetchImpl ??
      fetch;
  }

  get model(): string {
    return this.modelName;
  }

  configured(): boolean {
    return Boolean(
      this.apiKey
    );
  }

  private headers():
    Record<string, string> {
    if (!this.apiKey) {
      throw new AiProviderError(
        "Anthropic provider is not configured.",
        {
          code:
            "ANTHROPIC_NOT_CONFIGURED",
          retryable:
            true
        }
      );
    }

    return {
      "x-api-key":
        this.apiKey,

      "anthropic-version":
        "2023-06-01",

      "Content-Type":
        "application/json"
    };
  }

  private body(
    request: AiRequest,
    stream: boolean
  ): Record<string, unknown> {
    return {
      ...requestBody(
        request,
        stream
      ),

      model:
        this.model
    };
  }

  async generate(
    request: AiRequest,
    signal: AbortSignal
  ): Promise<AiResult> {
    let response: Response;

    try {
      response =
        await this.fetchImpl(
          "https://api.anthropic.com/v1/messages",
          {
            method:
              "POST",

            headers: {
              ...this.headers(),
              "Accept":
                "application/json"
            },

            body:
              JSON.stringify(
                this.body(
                  request,
                  false
                )
              ),

            signal
          }
        );
    } catch {
      if (signal.aborted) {
        throw new AiProviderError(
          "Anthropic request aborted.",
          {
            code:
              "ANTHROPIC_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Anthropic network request failed.",
        {
          code:
            "ANTHROPIC_NETWORK_ERROR",
          retryable:
            true
        }
      );
    }

    if (!response.ok) {
      throw await failureFrom(
        response
      );
    }

    const data =
      await response.json()
        as AnthropicResponse;

    const text =
      textFrom(data);

    if (!text.trim()) {
      throw new AiProviderError(
        "Anthropic returned no text.",
        {
          code:
            "ANTHROPIC_EMPTY_RESPONSE",
          retryable:
            true
        }
      );
    }

    return {
      text,

      provider:
        this.id,

      model:
        this.model,

      usage:
        usageFrom(
          data.usage
        )
    };
  }

  async stream(
    request: AiRequest,
    signal: AbortSignal,
    onDelta:
      (
        delta: string
      ) =>
        void |
        Promise<void>
  ): Promise<AiStreamCompleted> {
    let response: Response;

    try {
      response =
        await this.fetchImpl(
          "https://api.anthropic.com/v1/messages",
          {
            method:
              "POST",

            headers: {
              ...this.headers(),
              "Accept":
                "text/event-stream"
            },

            body:
              JSON.stringify(
                this.body(
                  request,
                  true
                )
              ),

            signal
          }
        );
    } catch {
      if (signal.aborted) {
        throw new AiProviderError(
          "Anthropic stream aborted.",
          {
            code:
              "ANTHROPIC_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Anthropic stream network request failed.",
        {
          code:
            "ANTHROPIC_NETWORK_ERROR",
          retryable:
            true
        }
      );
    }

    if (!response.ok) {
      throw await failureFrom(
        response
      );
    }

    if (!response.body) {
      throw new AiProviderError(
        "Anthropic stream body missing.",
        {
          code:
            "ANTHROPIC_STREAM_MISSING",
          retryable:
            true
        }
      );
    }

    let inputTokens:
      number |
      undefined;

    let outputTokens:
      number |
      undefined;

    let outputChars = 0;
    let finished = false;

    for await (
      const event
      of parseSse(
        response.body
      )
    ) {
      let parsed: {
        type?: string;

        message?: {
          usage?: {
            input_tokens?:
              number;
            output_tokens?:
              number;
          };
        };

        content_block?: {
          type?: string;
          text?: string;
        };

        delta?: {
          type?: string;
          text?: string;
        };

        usage?: {
          output_tokens?:
            number;
        };

        error?: {
          type?: string;
        };
      };

      try {
        parsed =
          JSON.parse(
            event.data
          ) as typeof parsed;
      } catch {
        continue;
      }

      if (
        parsed.type ===
        "error"
      ) {
        throw new AiProviderError(
          "Anthropic stream failed.",
          {
            code:
              "ANTHROPIC_STREAM_ERROR",

            retryable:
              isRetryableStreamError(
                parsed.error?.type
              )
          }
        );
      }

      if (
        parsed.type ===
          "message_start"
      ) {
        inputTokens =
          parsed.message
            ?.usage
            ?.input_tokens;
      }

      if (
        parsed.type ===
          "content_block_start" &&
        parsed.content_block
          ?.type ===
          "text" &&
        parsed.content_block
          .text
      ) {
        const delta =
          parsed.content_block
            .text;

        outputChars +=
          delta.length;

        await onDelta(delta);
      }

      if (
        parsed.type ===
          "content_block_delta" &&
        parsed.delta?.type ===
          "text_delta" &&
        parsed.delta.text
      ) {
        const delta =
          parsed.delta.text;

        outputChars +=
          delta.length;

        await onDelta(delta);
      }

      if (
        parsed.type ===
          "message_delta" &&
        typeof parsed.usage
          ?.output_tokens ===
          "number"
      ) {
        outputTokens =
          parsed.usage
            .output_tokens;
      }

      if (
        parsed.type ===
          "message_stop"
      ) {
        finished = true;
      }
    }

    if (
      outputChars === 0 ||
      !finished
    ) {
      throw new AiProviderError(
        "Anthropic stream ended before completion.",
        {
          code:
            "ANTHROPIC_STREAM_INCOMPLETE",
          retryable:
            true
        }
      );
    }

    return {
      provider:
        this.id,

      model:
        this.model,

      usage: {
        inputTokens,
        outputTokens,

        totalTokens:
          typeof inputTokens ===
            "number" &&
          typeof outputTokens ===
            "number"
            ? inputTokens +
              outputTokens
            : undefined
      }
    };
  }
}
