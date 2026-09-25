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

class DownstreamCallbackError
  extends Error {
  readonly cause:
    unknown;

  constructor(
    cause: unknown
  ) {
    super(
      "AI downstream callback failed."
    );

    this.name =
      "DownstreamCallbackError";

    this.cause =
      cause;
  }
}

async function notifyAttempt(
  callback:
    GatewayOptions["onAttempt"],
  attempt: AiAttempt
): Promise<void> {
  try {
    await callback?.(
      attempt
    );
  } catch {
    /*
     * Usage/audit observers are not part of
     * provider execution and must never change
     * routing or provider health.
     */
  }
}

async function downstream(
  callback:
    () =>
      void |
      Promise<void>
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    throw new DownstreamCallbackError(
      error
    );
  }
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
    if (
      error.code ===
      "AI_PROVIDER_TIMEOUT"
    ) {
      return error.code;
    }

    if (
      typeof error.httpStatus ===
      "number"
    ) {
      if (
        error.httpStatus ===
        408
      ) {
        return "AI_UPSTREAM_TIMEOUT";
      }

      if (
        error.httpStatus ===
        429
      ) {
        return error.retryable
          ? "AI_UPSTREAM_RATE_LIMITED"
          : "AI_UPSTREAM_LIMIT_REACHED";
      }

      if (
        error.httpStatus ===
          401 ||
        error.httpStatus ===
          403
      ) {
        return "AI_UPSTREAM_AUTH_ERROR";
      }

      if (
        error.httpStatus >=
        500
      ) {
        return "AI_UPSTREAM_SERVER_ERROR";
      }

      return "AI_UPSTREAM_REQUEST_ERROR";
    }

    return error.retryable
      ? "AI_PROVIDER_RETRYABLE_ERROR"
      : "AI_PROVIDER_ERROR";
  }

  if (
    error instanceof Error
  ) {
    return "AI_PROVIDER_EXCEPTION";
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
    undefined,
  timeoutMs: number
): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
  abortedByParent:
    () => boolean;
} {
  const controller =
    new AbortController();

  let abortSource:
    "timeout" |
    "parent" |
    undefined;

  const timer =
    setTimeout(
      () => {
        if (
          controller.signal
            .aborted
        ) {
          return;
        }

        abortSource =
          "timeout";

        controller.abort(
          new Error(
            "AI request timeout"
          )
        );
      },
      timeoutMs
    );

  const abort =
    (): void => {
      if (
        controller.signal
          .aborted
      ) {
        return;
      }

      abortSource =
        "parent";

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
      },

    timedOut:
      () =>
        abortSource ===
        "timeout",

    abortedByParent:
      () =>
        abortSource ===
        "parent"
  };
}

function providerTimeoutError(
  providerId: string
): AiProviderError {
  return new AiProviderError(
    `AI provider ${providerId} request timed out.`,
    {
      code:
        "AI_PROVIDER_TIMEOUT",

      retryable:
        true,

      httpStatus:
        504
    }
  );
}

function clientAbortError():
  AiProviderError {
  return new AiProviderError(
    "AI request was aborted by the client.",
    {
      code:
        "AI_CLIENT_ABORTED",

      retryable:
        false
    }
  );
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

  private readonly requestTimeoutMs:
    number;

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
        }),
    requestTimeoutMs:
      number =
        env.AI_REQUEST_TIMEOUT_MS
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

    this.requestTimeoutMs =
      Math.max(
        1,
        Math.trunc(
          requestTimeoutMs
        )
      );
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
          options.signal,
          this.requestTimeoutMs
        );

      try {
        const result =
          await provider.generate(
            request,
            child.signal
          );

        if (
          child.timedOut()
        ) {
          throw providerTimeoutError(
            provider.id
          );
        }

        if (
          child
            .abortedByParent()
        ) {
          throw clientAbortError();
        }

        const latencyMs =
          Date.now() -
          started;

        this.health.success(
          provider.id,
          latencyMs,
          lease.probeId
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

        await notifyAttempt(
          options.onAttempt,
          attempt
        );

        return {
          ...result,
          attempts
        };
      } catch (error) {
        const timedOut =
          child.timedOut();

        const aborted =
          child
            .abortedByParent();

        const effectiveError =
          timedOut
            ? providerTimeoutError(
                provider.id
              )
            : error;

        lastError =
          effectiveError;

        const isRetryable =
          !aborted &&
          retryable(
            effectiveError
          );

        const latencyMs =
          Date.now() -
          started;

        const safeErrorCode =
          aborted
            ? "AI_CLIENT_ABORTED"
            : errorCode(
                effectiveError
              );

        if (aborted) {
          this.health.release(
            provider.id,
            lease.probeId
          );
        } else {
          this.health.failure(
            provider.id,
            {
              retryable:
                isRetryable,
              latencyMs,
              errorCode:
                safeErrorCode,

              probeId:
                lease.probeId
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

        await notifyAttempt(
          options.onAttempt,
          attempt
        );

        if (
          aborted ||
          selection.explicit ||
          !isRetryable
        ) {
          throw effectiveError;
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
          options.signal,
          this.requestTimeoutMs
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
              if (
                child.timedOut()
              ) {
                throw providerTimeoutError(
                  provider.id
                );
              }

              if (
                child
                  .abortedByParent()
              ) {
                throw clientAbortError();
              }

              if (!emitted) {
                emitted = true;

                await downstream(
                  () =>
                    options.onProvider({
                      id:
                        provider.id,

                      model:
                        provider.model
                    })
                );
              }

              outputChars +=
                delta.length;

              await downstream(
                () =>
                  options.onDelta(
                    delta
                  )
              );
            }
          );

        if (
          child.timedOut()
        ) {
          throw providerTimeoutError(
            provider.id
          );
        }

        if (
          child
            .abortedByParent()
        ) {
          throw clientAbortError();
        }

        const latencyMs =
          Date.now() -
          started;

        this.health.success(
          provider.id,
          latencyMs,
          lease.probeId
        );

        if (!emitted) {
          await downstream(
            () =>
              options.onProvider({
                id:
                  provider.id,

                model:
                  provider.model
              })
          );
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

        await notifyAttempt(
          options.onAttempt,
          attempt
        );

        return {
          completed,
          attempts
        };
      } catch (error) {
        if (
          error instanceof
            DownstreamCallbackError
        ) {
          this.health.release(
            provider.id,
            lease.probeId
          );

          throw error.cause;
        }

        const timedOut =
          child.timedOut();

        const aborted =
          child
            .abortedByParent();

        const effectiveError =
          timedOut
            ? providerTimeoutError(
                provider.id
              )
            : error;

        lastError =
          effectiveError;

        const isRetryable =
          !aborted &&
          retryable(
            effectiveError
          );

        const latencyMs =
          Date.now() -
          started;

        const safeErrorCode =
          aborted
            ? "AI_CLIENT_ABORTED"
            : errorCode(
                effectiveError
              );

        if (aborted) {
          this.health.release(
            provider.id,
            lease.probeId
          );
        } else {
          this.health.failure(
            provider.id,
            {
              retryable:
                isRetryable,
              latencyMs,
              errorCode:
                safeErrorCode,

              probeId:
                lease.probeId
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

        await notifyAttempt(
          options.onAttempt,
          attempt
        );

        if (
          emitted ||
          aborted ||
          selection.explicit ||
          !isRetryable
        ) {
          throw effectiveError;
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
