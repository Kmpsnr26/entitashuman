import { env } from "../config/env.js";

import {
  AiProviderError,
  type AiAttempt,
  type AiGatewayResult,
  type AiProvider,
  type AiRequest,
  type AiStreamCompleted
} from "./types.js";

interface GatewayOptions {
  provider?: string;

  signal?:
    AbortSignal;

  onAttempt?:
    (
      attempt:
        AiAttempt
    ) =>
      void |
      Promise<void>;
}

interface StreamOptions
  extends GatewayOptions {
  onProvider:
    (
      provider: {
        id: string;
        model: string;
      }
    ) =>
      void |
      Promise<void>;

  onDelta:
    (
      delta: string
    ) =>
      void |
      Promise<void>;
}

function inputChars(
  request: AiRequest
): number {
  return (
    request.message.length +
    request.history.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.content.length,
      0
    )
  );
}

function providerOrder(
  value: string
): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map(
          item =>
            item
              .trim()
              .toLowerCase()
        )
        .filter(Boolean)
    )
  ];
}

function errorCode(
  error: unknown
): string {
  if (
    error instanceof
    AiProviderError
  ) {
    return error.code;
  }

  if (
    error instanceof Error
  ) {
    return error.name
      .slice(0, 100);
  }

  return "AI_UNKNOWN_ERROR";
}

function retryable(
  error: unknown
): boolean {
  return (
    error instanceof
      AiProviderError &&
    error.retryable
  );
}

function childSignal(
  parent:
    AbortSignal |
    undefined
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(
          new Error(
            "AI request timeout"
          )
        ),
      env.AI_REQUEST_TIMEOUT_MS
    );

  const abort =
    (): void => {
      controller.abort(
        parent?.reason
      );
    };

  if (parent) {
    if (parent.aborted) {
      abort();
    } else {
      parent.addEventListener(
        "abort",
        abort,
        {
          once: true
        }
      );
    }
  }

  return {
    signal:
      controller.signal,

    cleanup:
      () => {
        clearTimeout(timer);

        parent?.removeEventListener(
          "abort",
          abort
        );
      }
  };
}

export class AiGateway {
  private readonly providers:
    Map<string, AiProvider>;

  private readonly automaticOrder:
    string[];

  constructor(
    providers: AiProvider[]
  ) {
    this.providers =
      new Map(
        providers.map(
          provider => [
            provider.id,
            provider
          ]
        )
      );

    this.automaticOrder =
      providerOrder(
        env.AI_PROVIDER_ORDER
      );
  }

  status(): Array<{
    id: string;
    model: string;
    configured: boolean;
  }> {
    return [
      ...this.providers.values()
    ].map(
      provider => ({
        id:
          provider.id,

        model:
          provider.model,

        configured:
          provider.configured()
      })
    );
  }

  private candidates(
    requested =
      "auto"
  ): AiProvider[] {
    const normalized =
      requested
        .trim()
        .toLowerCase();

    if (
      normalized !==
      "auto"
    ) {
      const provider =
        this.providers.get(
          normalized
        );

      if (
        !provider ||
        !provider.configured()
      ) {
        throw new AiProviderError(
          "Requested AI provider is unavailable.",
          {
            code:
              "AI_PROVIDER_UNAVAILABLE",
            retryable:
              false
          }
        );
      }

      return [provider];
    }

    const providers =
      this.automaticOrder
        .map(
          id =>
            this.providers.get(
              id
            )
        )
        .filter(
          (
            provider
          ): provider is AiProvider =>
            Boolean(
              provider?.configured()
            )
        );

    if (!providers.length) {
      throw new AiProviderError(
        "No AI provider is configured.",
        {
          code:
            "AI_NO_PROVIDER",
          retryable:
            false
        }
      );
    }

    return providers;
  }

  async generate(
    request: AiRequest,
    options:
      GatewayOptions = {}
  ): Promise<AiGatewayResult> {
    const candidates =
      this.candidates(
        options.provider
      );

    const attempts:
      AiAttempt[] = [];

    let previous:
      string |
      undefined;

    for (
      let index = 0;
      index <
      candidates.length;
      index += 1
    ) {
      const provider =
        candidates[index]!;

      const started =
        Date.now();

      const child =
        childSignal(
          options.signal
        );

      try {
        const result =
          await provider.generate(
            request,
            child.signal
          );

        const attempt:
          AiAttempt = {
            provider:
              provider.id,

            model:
              provider.model,

            status:
              "success",

            latencyMs:
              Date.now() -
              started,

            inputChars:
              inputChars(
                request
              ),

            outputChars:
              result.text.length,

            usage:
              result.usage,

            fallbackFrom:
              previous
          };

        attempts.push(
          attempt
        );

        await options
          .onAttempt?.(
            attempt
          );

        return {
          ...result,
          attempts
        };
      } catch (error) {
        const aborted =
          child.signal.aborted ||
          options.signal?.aborted;

        const attempt:
          AiAttempt = {
            provider:
              provider.id,

            model:
              provider.model,

            status:
              aborted
                ? "aborted"
                : "error",

            latencyMs:
              Date.now() -
              started,

            inputChars:
              inputChars(
                request
              ),

            outputChars:
              0,

            usage:
              {},

            errorCode:
              errorCode(error),

            fallbackFrom:
              previous
          };

        attempts.push(
          attempt
        );

        await options
          .onAttempt?.(
            attempt
          );

        child.cleanup();

        if (
          aborted ||
          options.provider !==
            undefined &&
          options.provider !==
            "auto" ||
          !retryable(error) ||
          index ===
            candidates.length - 1
        ) {
          throw error;
        }

        previous =
          provider.id;

        continue;
      } finally {
        child.cleanup();
      }
    }

    throw new AiProviderError(
      "No AI provider completed the request.",
      {
        code:
          "AI_GATEWAY_FAILED",
        retryable:
          false
      }
    );
  }

  async stream(
    request: AiRequest,
    options:
      StreamOptions
  ): Promise<{
    completed:
      AiStreamCompleted;
    attempts:
      AiAttempt[];
  }> {
    const candidates =
      this.candidates(
        options.provider
      );

    const attempts:
      AiAttempt[] = [];

    let previous:
      string |
      undefined;

    for (
      let index = 0;
      index <
      candidates.length;
      index += 1
    ) {
      const provider =
        candidates[index]!;

      const started =
        Date.now();

      const child =
        childSignal(
          options.signal
        );

      let outputChars = 0;
      let emitted = false;

      try {
        const completed =
          await provider.stream(
            request,
            child.signal,
            async (
              delta
            ) => {
              if (!emitted) {
                emitted = true;

                await options
                  .onProvider({
                    id:
                      provider.id,

                    model:
                      provider.model
                  });
              }

              outputChars +=
                delta.length;

              await options
                .onDelta(
                  delta
                );
            }
          );

        if (!emitted) {
          await options
            .onProvider({
              id:
                provider.id,

              model:
                provider.model
            });
        }

        const attempt:
          AiAttempt = {
            provider:
              provider.id,

            model:
              provider.model,

            status:
              "success",

            latencyMs:
              Date.now() -
              started,

            inputChars:
              inputChars(
                request
              ),

            outputChars,

            usage:
              completed.usage,

            fallbackFrom:
              previous
          };

        attempts.push(
          attempt
        );

        await options
          .onAttempt?.(
            attempt
          );

        return {
          completed,
          attempts
        };
      } catch (error) {
        const aborted =
          child.signal.aborted ||
          options.signal?.aborted;

        const attempt:
          AiAttempt = {
            provider:
              provider.id,

            model:
              provider.model,

            status:
              aborted
                ? "aborted"
                : "error",

            latencyMs:
              Date.now() -
              started,

            inputChars:
              inputChars(
                request
              ),

            outputChars,

            usage:
              {},

            errorCode:
              errorCode(error),

            fallbackFrom:
              previous
          };

        attempts.push(
          attempt
        );

        await options
          .onAttempt?.(
            attempt
          );

        if (
          emitted ||
          aborted ||
          options.provider !==
            undefined &&
          options.provider !==
            "auto" ||
          !retryable(error) ||
          index ===
            candidates.length - 1
        ) {
          throw error;
        }

        previous =
          provider.id;
      } finally {
        child.cleanup();
      }
    }

    throw new AiProviderError(
      "No AI provider completed the stream.",
      {
        code:
          "AI_GATEWAY_FAILED",
        retryable:
          false
      }
    );
  }
}
