export type ProviderHealthState =
  | "ready"
  | "degraded"
  | "unavailable";

export type ProviderCircuitState =
  | "healthy"
  | "degraded"
  | "open"
  | "half-open";

export interface ProviderHealthSnapshot {
  state: ProviderHealthState;
  circuitState:
    | ProviderCircuitState
    | "unavailable";
  consecutiveFailures: number;
  successes: number;
  failures: number;
  successRate: number | null;
  averageLatencyMs: number | null;
  lastLatencyMs?: number;
  lastErrorCode?: string;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  nextProbeAt?: number;
  probeInFlight: boolean;
}

interface ProviderHealthRecord {
  circuitState:
    ProviderCircuitState;
  consecutiveFailures: number;
  successes: number;
  failures: number;
  averageLatencyMs?: number;
  lastLatencyMs?: number;
  lastErrorCode?: string;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  probeInFlight: boolean;
}

interface ProviderHealthOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  maxSamples?: number;
  now?: () => number;
}

export interface ProviderLease {
  allowed: boolean;
  state: ProviderHealthState;
  circuitState:
    | ProviderCircuitState
    | "unavailable";
  probe: boolean;
}

interface FailureOptions {
  retryable: boolean;
  latencyMs: number;
  errorCode?: string;
}

const MAX_LATENCY_MS =
  10 * 60 * 1000;

function boundedLatency(
  value: number
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      MAX_LATENCY_MS,
      Math.round(value)
    )
  );
}

const SAFE_ERROR_CODES =
  new Set([
    "AI_PROVIDER_TIMEOUT",
    "AI_UPSTREAM_TIMEOUT",
    "AI_UPSTREAM_RATE_LIMITED",
    "AI_UPSTREAM_AUTH_ERROR",
    "AI_UPSTREAM_SERVER_ERROR",
    "AI_UPSTREAM_REQUEST_ERROR",
    "AI_PROVIDER_RETRYABLE_ERROR",
    "AI_PROVIDER_ERROR",
    "AI_PROVIDER_EXCEPTION",
    "AI_UNKNOWN_ERROR"
  ]);

function safeErrorCode(
  value: string | undefined,
  retryable: boolean
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized =
    value
      .trim()
      .toUpperCase()
      .replace(
        /[^A-Z0-9_]/g,
        "_"
      )
      .slice(0, 100);

  if (
    SAFE_ERROR_CODES.has(
      normalized
    )
  ) {
    return normalized;
  }

  return retryable
    ? "AI_PROVIDER_RETRYABLE_ERROR"
    : "AI_PROVIDER_ERROR";
}

function publicState(
  circuitState:
    ProviderCircuitState
): ProviderHealthState {
  if (
    circuitState ===
      "open"
  ) {
    return "unavailable";
  }

  if (
    circuitState ===
      "degraded" ||
    circuitState ===
      "half-open"
  ) {
    return "degraded";
  }

  return "ready";
}

export class ProviderHealthRegistry {
  private readonly failureThreshold:
    number;

  private readonly cooldownMs:
    number;

  private readonly maxSamples:
    number;

  private readonly now:
    () => number;

  private readonly records =
    new Map<
      string,
      ProviderHealthRecord
    >();

  constructor(
    options:
      ProviderHealthOptions = {}
  ) {
    this.failureThreshold =
      Math.max(
        1,
        Math.min(
          20,
          Math.trunc(
            options.failureThreshold ??
            3
          )
        )
      );

    this.cooldownMs =
      Math.max(
        1_000,
        Math.min(
          30 * 60 * 1000,
          Math.trunc(
            options.cooldownMs ??
            60_000
          )
        )
      );

    this.maxSamples =
      Math.max(
        10,
        Math.min(
          1_000_000,
          Math.trunc(
            options.maxSamples ??
            1_000_000
          )
        )
      );

    this.now =
      options.now ??
      (() => Date.now());
  }

  private record(
    providerId: string
  ): ProviderHealthRecord {
    let record =
      this.records.get(
        providerId
      );

    if (!record) {
      record = {
        circuitState:
          "healthy",
        consecutiveFailures:
          0,
        successes:
          0,
        failures:
          0,
        probeInFlight:
          false
      };

      this.records.set(
        providerId,
        record
      );
    }

    return record;
  }

  private compactCounters(
    record:
      ProviderHealthRecord
  ): void {
    const total =
      record.successes +
      record.failures;

    if (
      total <
      this.maxSamples
    ) {
      return;
    }

    record.successes =
      Math.floor(
        record.successes /
        2
      );

    record.failures =
      Math.floor(
        record.failures /
        2
      );
  }

  private recordLatency(
    record:
      ProviderHealthRecord,
    latencyMs: number
  ): void {
    const latency =
      boundedLatency(
        latencyMs
      );

    record.lastLatencyMs =
      latency;

    if (
      record.averageLatencyMs ===
      undefined
    ) {
      record.averageLatencyMs =
        latency;

      return;
    }

    /*
     * Bounded exponential moving average.
     * Recent latency matters without keeping
     * an unbounded sample history.
     */
    record.averageLatencyMs =
      Math.round(
        record.averageLatencyMs *
          0.8 +
        latency *
          0.2
      );
  }

  acquire(
    providerId: string,
    configured: boolean
  ): ProviderLease {
    if (!configured) {
      return {
        allowed:
          false,
        state:
          "unavailable",
        circuitState:
          "unavailable",
        probe:
          false
      };
    }

    const record =
      this.record(
        providerId
      );

    if (
      record.circuitState ===
      "open"
    ) {
      const openedAt =
        record.openedAt ??
        this.now();

      if (
        this.now() -
        openedAt <
        this.cooldownMs
      ) {
        return {
          allowed:
            false,
          state:
            "unavailable",
          circuitState:
            "open",
          probe:
            false
        };
      }

      if (
        record.probeInFlight
      ) {
        return {
          allowed:
            false,
          state:
            "degraded",
          circuitState:
            "half-open",
          probe:
            false
        };
      }

      record.circuitState =
        "half-open";

      record.probeInFlight =
        true;

      return {
        allowed:
          true,
        state:
          "degraded",
        circuitState:
          "half-open",
        probe:
          true
      };
    }

    if (
      record.circuitState ===
      "half-open"
    ) {
      if (
        record.probeInFlight
      ) {
        return {
          allowed:
            false,
          state:
            "degraded",
          circuitState:
            "half-open",
          probe:
            false
        };
      }

      record.probeInFlight =
        true;

      return {
        allowed:
          true,
        state:
          "degraded",
        circuitState:
          "half-open",
        probe:
          true
      };
    }

    return {
      allowed:
        true,
      state:
        publicState(
          record.circuitState
        ),
      circuitState:
        record.circuitState,
      probe:
        false
    };
  }

  success(
    providerId: string,
    latencyMs = 0
  ): void {
    const record =
      this.record(
        providerId
      );

    this.compactCounters(
      record
    );

    record.successes +=
      1;

    this.recordLatency(
      record,
      latencyMs
    );

    record.circuitState =
      "healthy";

    record.consecutiveFailures =
      0;

    record.lastSuccessAt =
      this.now();

    record.openedAt =
      undefined;

    record.probeInFlight =
      false;

    record.lastErrorCode =
      undefined;
  }

  failure(
    providerId: string,
    options:
      FailureOptions
  ): void {
    const record =
      this.record(
        providerId
      );

    const now =
      this.now();

    this.compactCounters(
      record
    );

    record.failures +=
      1;

    this.recordLatency(
      record,
      options.latencyMs
    );

    record.lastFailureAt =
      now;

    record.lastErrorCode =
      safeErrorCode(
        options.errorCode,
        options.retryable
      );

    record.probeInFlight =
      false;

    if (
      !options.retryable
    ) {
      /*
       * Non-retryable failures remain visible in
       * bounded telemetry, but they do not change
       * circuit health or the retryable failure
       * count. This also applies to half-open:
       * a request-specific/provider-declared
       * non-retryable failure is not evidence that
       * the provider is operationally unhealthy.
       */
      return;
    }

    record.consecutiveFailures =
      Math.min(
        this.failureThreshold,
        record.consecutiveFailures +
        1
      );

    if (
      record.circuitState ===
        "half-open" ||
      record.consecutiveFailures >=
        this.failureThreshold
    ) {
      record.circuitState =
        "open";

      record.openedAt =
        now;

      return;
    }

    record.circuitState =
      "degraded";
  }

  retryableFailure(
    providerId: string,
    latencyMs = 0,
    errorCode?: string
  ): void {
    this.failure(
      providerId,
      {
        retryable:
          true,
        latencyMs,
        errorCode
      }
    );
  }

  release(
    providerId: string
  ): void {
    const record =
      this.records.get(
        providerId
      );

    if (!record) {
      return;
    }

    /*
     * Releasing an abandoned/client-aborted probe
     * must not change provider health. If the
     * circuit is half-open, keep it half-open and
     * only release the single-probe lease so a
     * later request can perform a real health
     * probe.
     */
    record.probeInFlight =
      false;
  }

  snapshot(
    providerId: string,
    configured: boolean
  ): ProviderHealthSnapshot {
    if (!configured) {
      return {
        state:
          "unavailable",
        circuitState:
          "unavailable",
        consecutiveFailures:
          0,
        successes:
          0,
        failures:
          0,
        successRate:
          null,
        averageLatencyMs:
          null,
        probeInFlight:
          false
      };
    }

    const record =
      this.record(
        providerId
      );

    const total =
      record.successes +
      record.failures;

    const successRate =
      total > 0
        ? Math.round(
            (
              record.successes /
              total
            ) *
            10_000
          ) /
          10_000
        : null;

    return {
      state:
        publicState(
          record.circuitState
        ),
      circuitState:
        record.circuitState,
      consecutiveFailures:
        record
          .consecutiveFailures,
      successes:
        record.successes,
      failures:
        record.failures,
      successRate,
      averageLatencyMs:
        record.averageLatencyMs ??
        null,
      lastLatencyMs:
        record.lastLatencyMs,
      lastErrorCode:
        record.lastErrorCode,
      lastFailureAt:
        record.lastFailureAt,
      lastSuccessAt:
        record.lastSuccessAt,
      openedAt:
        record.openedAt,
      nextProbeAt:
        record.openedAt !==
        undefined
          ? record.openedAt +
            this.cooldownMs
          : undefined,
      probeInFlight:
        record.probeInFlight
    };
  }
}
