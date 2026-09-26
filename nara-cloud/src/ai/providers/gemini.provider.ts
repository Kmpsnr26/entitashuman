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

interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    status?: string;
  };
}

function contents(
  request: AiRequest
): Array<{
  role: "user" | "model";
  parts: Array<{
    text: string;
  }>;
}> {
  return [
    ...request.history.map(
      item => ({
        role:
          item.role ===
          "assistant"
            ? "model" as const
            : "user" as const,

        parts: [
          {
            text:
              item.content
          }
        ]
      })
    ),

    {
      role:
        "user" as const,

      parts: [
        {
          text:
            request.message
        }
      ]
    }
  ];
}

function requestBody(
  request: AiRequest
): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [
        {
          text:
            NARA_SYSTEM_PROMPT
        }
      ]
    },

    contents:
      contents(request),

    generationConfig: {
      maxOutputTokens:
        env.AI_MAX_OUTPUT_TOKENS
    } 
  };
}

function textFrom(
  response:
    GeminiResponse
): string {
  const pieces:
    string[] = [];

  for (
    const candidate
    of response.candidates ?? []
  ) {
    for (
      const part
      of candidate
        .content
        ?.parts ?? []
    ) {
      if (
        typeof part.text ===
          "string"
      ) {
        pieces.push(
          part.text
        );
      }
    }
  }

  return pieces.join("");
}

function usageFrom(
  response:
    GeminiResponse
) {
  const usage =
    response.usageMetadata;

  return {
    inputTokens:
      usage
        ?.promptTokenCount,

    outputTokens:
      usage
        ?.candidatesTokenCount,

    totalTokens:
      usage
        ?.totalTokenCount
  };
}

const GEMINI_RETRYABLE_STREAM_CODES =
  new Set([
    "RESOURCE_EXHAUSTED",
    "INTERNAL",
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "RATE_LIMIT_EXCEEDED",
    "QUOTA_EXCEEDED",
    "TOO_MANY_REQUESTS",
    "API_ERROR",
    "SERVICE_UNAVAILABLE"
  ]);

function isRetryableStreamError(
  error:
    GeminiResponse["error"]
): boolean {
  if (!error) {
    return false;
  }

  if (
    typeof error.code ===
      "number" &&
    (
      error.code ===
        408 ||
      error.code ===
        429 ||
      error.code >=
        500
    )
  ) {
    return true;
  }

  return (
    typeof error.status ===
      "string" &&
    GEMINI_RETRYABLE_STREAM_CODES
      .has(
        error.status
          .trim()
          .toUpperCase()
      )
  );
}

async function failureFrom(
  response: Response
): Promise<AiProviderError> {
  const retryable =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;

  return new AiProviderError(
    "Gemini provider request failed.",
    {
      code:
        "GEMINI_UPSTREAM_ERROR",
      retryable,
      httpStatus:
        response.status
    }
  );
}

export class GeminiProvider
  implements AiProvider {

  readonly id = "gemini";

  private readonly apiKey:
    string |
    undefined;

  private readonly modelName:
    string;

  private readonly fetchImpl:
    FetchLike;

  constructor(
    options:
      GeminiProviderOptions = {}
  ) {
    this.apiKey =
      options.apiKey ??
      env.GEMINI_API_KEY;

    this.modelName =
      options.model ??
      env.GEMINI_MODEL;

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
        "Gemini provider is not configured.",
        {
          code:
            "GEMINI_NOT_CONFIGURED",
          retryable:
            true
        }
      );
    }

    return {
      "x-goog-api-key":
        this.apiKey,

      "Content-Type":
        "application/json"
    };
  }

  private endpoint(
    streaming:
      boolean
  ): string {
    const model =
      encodeURIComponent(
        this.model
      );

    const method =
      streaming
        ? "streamGenerateContent"
        : "generateContent";

    return (
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":" +
      method +
      (
        streaming
          ? "?alt=sse"
          : ""
      )
    );
  }

  async generate(
    request: AiRequest,
    signal: AbortSignal
  ): Promise<AiResult> {
    let response: Response;

    try {
      response =
        await this.fetchImpl(
          this.endpoint(false),
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
                  request
                )
              ),

            signal
          }
        );
    } catch {
      if (signal.aborted) {
        throw new AiProviderError(
          "Gemini request aborted.",
          {
            code:
              "GEMINI_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Gemini network request failed.",
        {
          code:
            "GEMINI_NETWORK_ERROR",
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
      (await response.json())
        as GeminiResponse;

    const text =
      textFrom(data);

    if (!text.trim()) {
      throw new AiProviderError(
        "Gemini returned no text.",
        {
          code:
            "GEMINI_EMPTY_RESPONSE",
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
          this.endpoint(true),
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
                  request
                )
              ),

            signal
          }
        );
    } catch {
      if (signal.aborted) {
        throw new AiProviderError(
          "Gemini stream aborted.",
          {
            code:
              "GEMINI_ABORTED",
            retryable:
              false
          }
        );
      }

      throw new AiProviderError(
        "Gemini stream network request failed.",
        {
          code:
            "GEMINI_NETWORK_ERROR",
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
        "Gemini stream body missing.",
        {
          code:
            "GEMINI_STREAM_MISSING",
          retryable:
            true
        }
      );
    }

    let outputChars = 0;
    let finished = false;
    let last:
      GeminiResponse |
      undefined;

    for await (
      const event
      of parseSse(
        response.body
      )
    ) {
      let parsed:
        GeminiResponse;

      try {
        parsed =
          JSON.parse(
            event.data
          ) as GeminiResponse;
      } catch {
        continue;
      }

      if (parsed.error) {
        throw new AiProviderError(
          "Gemini stream failed.",
          {
            code:
              "GEMINI_STREAM_ERROR",

            retryable:
              isRetryableStreamError(
                parsed.error
              )
          }
        );
      }

      const delta =
        textFrom(parsed);

      if (delta) {
        outputChars +=
          delta.length;

        await onDelta(delta);
      }

      if (
        parsed.candidates
          ?.some(
            candidate =>
              Boolean(
                candidate.finishReason
              )
          )
      ) {
        finished = true;
      }

      last = parsed;
    }

    if (
      outputChars === 0 ||
      !finished
    ) {
      throw new AiProviderError(
        "Gemini stream ended before completion.",
        {
          code:
            "GEMINI_STREAM_INCOMPLETE",
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
        usageFrom(
          last ?? {}
        )
    };
  }
}
