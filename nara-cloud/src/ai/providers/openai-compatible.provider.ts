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

interface OpenAiCompatibleOptions {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface CompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };

    delta?: {
      content?: string;
    };
  }>;

  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };

  error?: {
    code?: string;
    type?: string;
  };
}

function normalizedBaseUrl(
  value: string
): string {
  return value.replace(
    /\/+$/,
    ""
  );
}

function usageFrom(
  response:
    CompatibleResponse |
    undefined
) {
  return {
    inputTokens:
      response
        ?.usage
        ?.prompt_tokens,

    outputTokens:
      response
        ?.usage
        ?.completion_tokens,

    totalTokens:
      response
        ?.usage
        ?.total_tokens
  };
}

const COMPAT_RETRYABLE_STREAM_CODES =
  new Set([
    "slow_down",
    "server_is_overloaded",
    "rate_limit_exceeded",
    "server_error",
    "service_unavailable",
    "temporarily_unavailable",
    "timeout",
    "timeout_error"
  ]);

function isRetryableStreamError(
  error:
    CompatibleResponse["error"]
): boolean {
  if (!error) {
    return false;
  }

  const value =
    error.code ??
    error.type;

  return (
    typeof value ===
      "string" &&
    COMPAT_RETRYABLE_STREAM_CODES
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
  const retryable =
    response.status === 408 ||
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500;

  return new AiProviderError(
    "Compatible provider request failed.",
    {
      code:
        "COMPAT_UPSTREAM_ERROR",
      retryable,
      httpStatus:
        response.status
    }
  );
}

export class OpenAiCompatibleProvider
  implements AiProvider {

  readonly id: string;

  private readonly baseUrl:
    string |
    undefined;

  private readonly apiKey:
    string |
    undefined;

  private readonly modelName:
    string |
    undefined;

  private readonly fetchImpl:
    FetchLike;

  constructor(
    options:
      OpenAiCompatibleOptions = {}
  ) {
    this.id =
      options.id ??
      env.COMPAT_PROVIDER_ID;

    this.baseUrl =
      options.baseUrl ??
      env.COMPAT_API_BASE_URL;

    this.apiKey =
      options.apiKey ??
      env.COMPAT_API_KEY;

    this.modelName =
      options.model ??
      env.COMPAT_MODEL;

    this.fetchImpl =
      options.fetchImpl ??
      fetch;
  }

  get model(): string {
    return this.modelName ??
      "unconfigured";
  }

  configured(): boolean {
    return Boolean(
      this.baseUrl &&
      this.apiKey &&
      this.modelName
    );
  }

  private endpoint(): string {
    if (!this.baseUrl) {
      throw new AiProviderError(
        "Compatible provider base URL is not configured.",
        {
          code:
            "COMPAT_NOT_CONFIGURED",
          retryable:
            true
        }
      );
    }

    return (
      normalizedBaseUrl(
        this.baseUrl
      ) +
      "/chat/completions"
    );
  }

  private headers():
    Record<string, string> {
    if (!this.apiKey) {
      throw new AiProviderError(
        "Compatible provider API key is not configured.",
        {
          code:
            "COMPAT_NOT_CONFIGURED",
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

  private body(
    request: AiRequest,
    stream: boolean
  ): Record<string, unknown> {
    if (!this.modelName) {
      throw new AiProviderError(
        "Compatible provider model is not configured.",
        {
          code:
            "COMPAT_NOT_CONFIGURED",
          retryable:
            true
        }
      );
    }

    return {
      model:
        this.modelName,

      messages: [
        {
          role:
            "system",

          content:
            NARA_SYSTEM_PROMPT
        },

        ...request.history,

        {
          role:
            "user",

          content:
            request.message
        }
      ],

      max_tokens:
        env.AI_MAX_OUTPUT_TOKENS,

      stream
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
          this.endpoint(),
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
          "Compatible provider request aborted.",
          {
            code:
              "COMPAT_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Compatible provider network request failed.",
        {
          code:
            "COMPAT_NETWORK_ERROR",
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
        as CompatibleResponse;

    const text =
      data.choices?.[0]
        ?.message
        ?.content ??
      "";

    if (!text.trim()) {
      throw new AiProviderError(
        "Compatible provider returned no text.",
        {
          code:
            "COMPAT_EMPTY_RESPONSE",
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
        usageFrom(data)
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
          this.endpoint(),
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
          "Compatible provider stream aborted.",
          {
            code:
              "COMPAT_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Compatible provider stream network request failed.",
        {
          code:
            "COMPAT_NETWORK_ERROR",
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
        "Compatible provider stream body missing.",
        {
          code:
            "COMPAT_STREAM_MISSING",
          retryable:
            true
        }
      );
    }

    let outputChars = 0;
    let done = false;
    let last:
      CompatibleResponse |
      undefined;

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
        done = true;
        continue;
      }

      let parsed:
        CompatibleResponse;

      try {
        parsed =
          JSON.parse(
            event.data
          ) as CompatibleResponse;
      } catch {
        continue;
      }

      if (parsed.error) {
        throw new AiProviderError(
          "Compatible provider stream failed.",
          {
            code:
              "COMPAT_STREAM_ERROR",

            retryable:
              isRetryableStreamError(
                parsed.error
              )
          }
        );
      }

      const delta =
        parsed.choices?.[0]
          ?.delta
          ?.content ??
        "";

      if (delta) {
        outputChars +=
          delta.length;

        await onDelta(delta);
      }

      last = parsed;
    }

    if (
      outputChars === 0 ||
      !done
    ) {
      throw new AiProviderError(
        "Compatible provider stream ended before completion.",
        {
          code:
            "COMPAT_STREAM_INCOMPLETE",
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
        usageFrom(last)
    };
  }
}
