import { env } from "../../config/env.js";

import {
  AiProviderError,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiStreamCompleted
} from "../types.js";

import {
  extractOpenAiText,
  extractOpenAiUsage,
  type OpenAiResponse
} from "../openai-response.js";

import {
  parseSse
} from "../sse-parser.js";

import {
  ALECORE_AI_SYSTEM_PROMPT
} from "../systemPrompt.js";

const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";

type FetchLike =
  typeof fetch;

interface OpenAiProviderOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

function requestInput(
  request: AiRequest
): Array<{
  role: "user" | "assistant";
  content: string;
}> {
  return [
    ...request.history,
    {
      role: "user",
      content: request.message
    }
  ];
}

function requestBody(
  request: AiRequest,
  stream: boolean,
  model: string
): Record<string, unknown> {
  return {
    model,

    instructions:
      ALECORE_AI_SYSTEM_PROMPT,

    input:
      requestInput(request),

    store:
      false,

    stream,

    max_output_tokens:
      env.AI_MAX_OUTPUT_TOKENS
  };
}

const OPENAI_RETRYABLE_STREAM_CODES =
  new Set([
    "slow_down",
    "server_is_overloaded",
    "rate_limit_exceeded",
    "server_error"
  ]);

function isRetryableStreamError(
  value: unknown
): boolean {
  return (
    typeof value ===
      "string" &&
    OPENAI_RETRYABLE_STREAM_CODES
      .has(
        value
          .trim()
          .toLowerCase()
      )
  );
}

const OPENAI_NON_RETRYABLE_429_IDENTIFIERS =
  new Set([
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "insufficient_quota",
    "billing_hard_limit_reached"
  ]);

async function providerFailure(
  response: Response
): Promise<AiProviderError> {
  let upstreamIdentifier:
    string |
    undefined;

  if (
    response.status ===
    429
  ) {
    try {
      const data =
        (await response.json()) as {
            error?: {
              code?: string;
              type?: string;
            };
          };

      const candidate =
        data.error?.code ??
        data.error?.type;

      upstreamIdentifier =
        typeof candidate ===
          "string"
          ? candidate
              .trim()
              .toLowerCase()
          : undefined;
    } catch {
      // Classification only; never expose raw upstream body.
    }
  }

  const retryable429 =
    response.status ===
      429 &&
    (
      !upstreamIdentifier ||
      !OPENAI_NON_RETRYABLE_429_IDENTIFIERS
        .has(
          upstreamIdentifier
        )
    );

  const retryable =
    response.status === 408 ||
    response.status === 409 ||
    retryable429 ||
    response.status >= 500;

  return new AiProviderError(
    "OpenAI provider request failed.",
    {
      code:
        "OPENAI_UPSTREAM_ERROR",
      retryable,
      httpStatus:
        response.status
    }
  );
}

export class OpenAiProvider
  implements AiProvider {

  readonly id = "openai";

  private readonly apiKey:
    string |
    undefined;

  private readonly modelName:
    string;

  private readonly fetchImpl:
    FetchLike;

  constructor(
    options:
      OpenAiProviderOptions = {}
  ) {
    this.apiKey =
      options.apiKey ??
      env.OPENAI_API_KEY;

    this.modelName =
      options.model ??
      env.OPENAI_MODEL;

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
        "OpenAI provider is not configured.",
        {
          code:
            "OPENAI_NOT_CONFIGURED",
          retryable:
            true
        }
      );
    }

    return {
      "Authorization":
        `Bearer ${this.apiKey}`,

      "Content-Type":
        "application/json"
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
          OPENAI_RESPONSES_URL,
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
                requestBody(
                  request,
                  false,
                  this.model
                )
              ),

            signal
          }
        );
    } catch {
      if (
        signal.aborted
      ) {
        throw new AiProviderError(
          "OpenAI request aborted.",
          {
            code:
              "OPENAI_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "OpenAI network request failed.",
        {
          code:
            "OPENAI_NETWORK_ERROR",
          retryable:
            true
        }
      );
    }

    if (!response.ok) {
      throw await providerFailure(
        response
      );
    }

    const data =
      (await response.json()) as OpenAiResponse;

    if (
      data.status ===
        "incomplete"
    ) {
      throw new AiProviderError(
        "OpenAI response was incomplete.",
        {
          code:
            "OPENAI_RESPONSE_INCOMPLETE",
          retryable:
            false
        }
      );
    }

    const text =
      extractOpenAiText(data);

    if (!text.trim()) {
      throw new AiProviderError(
        "OpenAI returned no text.",
        {
          code:
            "OPENAI_EMPTY_RESPONSE",
          retryable:
            false
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
        extractOpenAiUsage(data)
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
          OPENAI_RESPONSES_URL,
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
                requestBody(
                  request,
                  true,
                  this.model
                )
              ),

            signal
          }
        );
    } catch {
      if (signal.aborted) {
        throw new AiProviderError(
          "OpenAI stream aborted.",
          {
            code:
              "OPENAI_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "OpenAI stream network request failed.",
        {
          code:
            "OPENAI_NETWORK_ERROR",
          retryable:
            true
        }
      );
    }

    if (!response.ok) {
      throw await providerFailure(
        response
      );
    }

    if (!response.body) {
      throw new AiProviderError(
        "OpenAI stream body missing.",
        {
          code:
            "OPENAI_STREAM_MISSING",
          retryable:
            true
        }
      );
    }

    let completed:
      OpenAiResponse |
      undefined;

    let outputChars = 0;

    for await (
      const event
      of parseSse(
        response.body
      )
    ) {
      if (
        event.data ===
        "[DONE]"
      ) {
        continue;
      }

      let parsed: {
        type?: string;
        delta?: string;
        response?: OpenAiResponse;
        error?: {
          code?: string;
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
          "response.output_text.delta" &&
        typeof parsed.delta ===
          "string" &&
        parsed.delta
      ) {
        outputChars +=
          parsed.delta.length;

        await onDelta(
          parsed.delta
        );
      }

      if (
        parsed.type ===
        "response.completed"
      ) {
        completed =
          parsed.response;
      }

      if (
        parsed.type ===
          "response.incomplete"
      ) {
        throw new AiProviderError(
          "OpenAI stream incomplete.",
          {
            code:
              "OPENAI_STREAM_INCOMPLETE",

            retryable:
              false
          }
        );
      }

      if (
        parsed.type ===
          "response.failed" ||
        parsed.type ===
          "error"
      ) {
        throw new AiProviderError(
          "OpenAI stream failed.",
          {
            code:
              "OPENAI_STREAM_ERROR",

            retryable:
              isRetryableStreamError(
                parsed.error?.code
              )
          }
        );
      }
    }

    if (
      !completed ||
      outputChars === 0
    ) {
      throw new AiProviderError(
        "OpenAI stream ended before completion.",
        {
          code:
            "OPENAI_STREAM_INCOMPLETE",
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

      usage:
        extractOpenAiUsage(
          completed
        )
    };
  }
}
