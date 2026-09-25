import { env } from "../config/env.js";

import {
  AiProviderError,
  type AiAttempt,
  type AiGatewayResult,
  type AiProvider,
  type AiRequest,
  type AiStreamCompleted
} from "./types.js";

import {
  ProviderHealthRegistry,
  type ProviderHealthSnapshot
} from "./provider-health.js";

interface GatewayOptions {
  provider?: string;

  signal?: AbortSignal;

  onAttempt?: (
    attempt: AiAttempt
  ) => void | Promise<void>;
}

interface StreamOptions
  extends GatewayOptions {

  onProvider: (
    provider: {
      id: string;
      model: string;
    }
  ) => void | Promise<void>;

  onDelta: (
    delta: string
  ) => void | Promise<void>;
}

export interface ProviderStatus {
  id: string;
  model: string;
  configured: boolean;
  health: ProviderHealthSnapshot;
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

function circuitOpenError(
  providerId: string
): AiProviderError {
  return new AiProviderError(
    `AI provider ${providerId} circuit is open.`,
    {
      code:
        "AI_PROVIDER_CIRCUIT_OPEN",

      retryable:
        false
    }
  );
}

export class AiGateway {
  private readonly providers:
    Map<string, AiProvider>;

  private readonly automaticOrder:
    string[];

  private readonly health:
    ProviderHealthRegistry;

  constructor(
    providers: AiProvider[],
    order:
      string =
        env.AI_PROVIDER_ORDER,
    health:
      ProviderHealthRegistry =
        new ProviderHealthRegistry({
          failureThreshold:
            env.AI_BREAKER_FAILURE_THRESHOLD,

          cooldownMs:
            env.AI_BREAKER_COOLDOWN_MS
        })
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
        order
      );

    this.health =
      health;
  }

  status():
    ProviderStatus[] {
    return [
      ...this.providers.values()
    ].map(
      provider => {
        const configured =
          provider.configured();

        return {
          id:
            provider.id,

          model:
            provider.model,

          configured,

          health:
            this.health.snapshot(
              provider.id,
              configured
            )
        };
      }
    );
  }

  private candidates(
    requested =
      "auto"
  ): {
    providers: AiProvider[];
    explicit: boolean;
  } {
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

      return {
        providers:
          [provider],

        explicit:
          true
      };
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

    return {
      providers,
      explicit:
        false
    };
  }

  async generate(
    request: AiRequest,
    options:
      GatewayOptions = {}
  ): Promise<AiGatewayResult> {
    const selection =
      this.candidates(
        options.provider
      );

    const attempts:
      AiAttempt[] = [];

    let previous:
      string |
      undefined;

    let lastError:
      unknown;

    let attempted = 0;

    for (
      const provider
      of selection.providers
    ) {
      const lease =
        this.health.acquire(
          provider.id,
          provider.configured()
        );

      if (!lease.allowed) {
        if (
          selection.explicit
        ) {
          throw circuitOpenError(
            provider.id
          );
        }

        continue;
      }

      attempted += 1;

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

        const latencyMs =
          Date.now() -
          started;

        this.health.success(
          provider.id,
          latencyMs
        );

        const attempt:
          AiAttempt = {
            provider:
              provider.id,

            model:
              provider.model,

            status:
              "success",

            latencyMs,

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
        lastError =
          error;

        const aborted =
          child.signal.aborted ||
          options.signal?.aborted;

        const isRetryable =
          !aborted &&
          retryable(error);

        const latencyMs =
          Date.now() -
          started;

        const safeErrorCode =
          errorCode(error);

        if (aborted) {
          this.health.release(
            provider.id
          );
        } else {
          this.health.failure(
            provider.id,
            {
              retryable:
                isRetryable,
              latencyMs,
              errorCode:
                safeErrorCode
            }
          );
        }

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

            latencyMs,

            inputChars:
              inputChars(
                request
              ),

            outputChars:
              0,

            usage:
              {},

            errorCode:
              safeErrorCode,

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
          aborted ||
          selection.explicit ||
          !isRetryable
        ) {
          throw error;
        }

        previous =
          provider.id;
      } finally {
        child.cleanup();
      }
    }

    if (
      attempted ===
      0
    ) {
      throw new AiProviderError(
        "No healthy AI provider is currently available.",
        {
          code:
            "AI_NO_HEALTHY_PROVIDER",

          retryable:
            false
        }
      );
    }

    if (lastError) {
      throw lastError;
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
    const selection =
      this.candidates(
        options.provider
      );

    const attempts:
      AiAttempt[] = [];

    let previous:
      string |
      undefined;

    let lastError:
      unknown;

    let attempted = 0;

    for (
      const provider
      of selection.providers
    ) {
      const lease =
        this.health.acquire(
          provider.id,
          provider.configured()
        );

      if (!lease.allowed) {
        if (
          selection.explicit
        ) {
          throw circuitOpenError(
            provider.id
          );
        }

        continue;
      }

      attempted += 1;

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

        const latencyMs =
          Date.now() -
          started;

        this.health.success(
          provider.id,
          latencyMs
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

            latencyMs,

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
        lastError =
          error;

        const aborted =
          child.signal.aborted ||
          options.signal?.aborted;

        const isRetryable =
          !aborted &&
          retryable(error);

        const latencyMs =
          Date.now() -
          started;

        const safeErrorCode =
          errorCode(error);

        if (aborted) {
          this.health.release(
            provider.id
          );
        } else {
          this.health.failure(
            provider.id,
            {
              retryable:
                isRetryable,
              latencyMs,
              errorCode:
                safeErrorCode
            }
          );
        }

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

            latencyMs,

            inputChars:
              inputChars(
                request
              ),

            outputChars,

            usage:
              {},

            errorCode:
              safeErrorCode,

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
          selection.explicit ||
          !isRetryable
        ) {
          throw error;
        }

        previous =
          provider.id;
      } finally {
        child.cleanup();
      }
    }

    if (
      attempted ===
      0
    ) {
      throw new AiProviderError(
        "No healthy AI provider is currently available.",
        {
          code:
            "AI_NO_HEALTHY_PROVIDER",

          retryable:
            false
        }
      );
    }

    if (lastError) {
      throw lastError;
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
