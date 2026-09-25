export type ProviderCircuitState =
  | "healthy"
  | "degraded"
  | "open"
  | "half-open"
  | "unavailable";

export type ProviderAvailability =
  | "ready"
  | "degraded"
  | "unavailable";

export interface ProviderHealthSnapshot {
  state: ProviderCircuitState;
  availability: ProviderAvailability;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  successRate?: number;
  latencyEmaMs?: number;
  lastLatencyMs?: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  nextProbeAt?: number;
  probeInFlight: boolean;
}

interface ProviderHealthRecord {
  state:
    Exclude<
      ProviderCircuitState,
      "unavailable"
    >;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  latencyEmaMs?: number;
  lastLatencyMs?: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  probeInFlight: boolean;
}

interface ProviderHealthOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export interface ProviderLease {
  allowed: boolean;
  state: ProviderCircuitState;
  probe: boolean;
}

const MAX_METRIC_COUNT =
  1_000_000;

const LATENCY_ALPHA =
  0.25;

function boundedCount(
  value: number
): number {
  return Math.max(
    0,
    Math.min(
      MAX_METRIC_COUNT,
      Math.trunc(value)
    )
  );
}

function safeLatency(
  value:
    number |
    undefined
): number | undefined {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(value)
  ) {
    return undefined;
  }

  return Math.max(
    0,
    Math.min(
      10 * 60 * 1000,
      Math.round(value)
    )
  );
}

function availabilityFrom(
  state:
    ProviderCircuitState
): ProviderAvailability {
  if (
    state === "healthy"
  ) {
    return "ready";
  }

  if (
    state === "degraded"
  ) {
    return "degraded";
  }

  return "unavailable";
}

export class ProviderHealthRegistry {
  private readonly failureThreshold:
    number;

  private readonly cooldownMs:
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
        state:
          "healthy",
        consecutiveFailures:
          0,
        successCount:
          0,
        failureCount:
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

  private recordLatency(
    record:
      ProviderHealthRecord,
    latencyMs:
      number |
      undefined
  ): void {
    const latency =
      safeLatency(
        latencyMs
      );

    if (
      latency ===
      undefined
    ) {
      return;
    }

    record.lastLatencyMs =
      latency;

    record.latencyEmaMs =
      record.latencyEmaMs ===
        undefined
        ? latency
        : Math.round(
            record.latencyEmaMs *
              (1 - LATENCY_ALPHA) +
            latency *
              LATENCY_ALPHA
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
        probe:
          false
      };
    }

    const record =
      this.record(
        providerId
      );

    if (
      record.state ===
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
            "half-open",
          probe:
            false
        };
      }

      record.state =
        "half-open";

      record.probeInFlight =
        true;

      return {
        allowed:
          true,
        state:
          "half-open",
        probe:
          true
      };
    }

    if (
      record.state ===
      "half-open"
    ) {
      if (
        record.probeInFlight
      ) {
        return {
          allowed:
            false,
          state:
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
          "half-open",
        probe:
          true
      };
    }

    return {
      allowed:
        true,
      state:
        record.state,
      probe:
        false
    };
  }

  success(
    providerId: string,
    latencyMs?: number
  ): void {
    const record =
      this.record(
        providerId
      );

    record.state =
      "healthy";

    record.consecutiveFailures =
      0;

    record.successCount =
      boundedCount(
        record.successCount +
        1
      );

    record.lastSuccessAt =
      this.now();

    record.openedAt =
      undefined;

    record.probeInFlight =
      false;

    this.recordLatency(
      record,
      latencyMs
    );
  }

  retryableFailure(
    providerId: string,
    latencyMs?: number
  ): void {
    const record =
      this.record(
        providerId
      );

    const now =
      this.now();

    record.lastFailureAt =
      now;

    record.failureCount =
      boundedCount(
        record.failureCount +
        1
      );

    record.consecutiveFailures =
      Math.min(
        this.failureThreshold,
        record.consecutiveFailures +
        1
      );

    record.probeInFlight =
      false;

    this.recordLatency(
      record,
      latencyMs
    );

    if (
      record.state ===
        "half-open" ||
      record.consecutiveFailures >=
        this.failureThreshold
    ) {
      record.state =
        "open";

      record.openedAt =
        now;

      return;
    }

    record.state =
      "degraded";
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

    if (
      record.state ===
      "half-open"
    ) {
      record.state =
        "open";
    }

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
        availability:
          "unavailable",
        consecutiveFailures:
          0,
        successCount:
          0,
        failureCount:
          0,
        probeInFlight:
          false
      };
    }

    const record =
      this.record(
        providerId
      );

    const total =
      record.successCount +
      record.failureCount;

    return {
      state:
        record.state,

      availability:
        availabilityFrom(
          record.state
        ),

      consecutiveFailures:
        record.consecutiveFailures,

      successCount:
        record.successCount,

      failureCount:
        record.failureCount,

      successRate:
        total > 0
          ? Number(
              (
                record.successCount /
                total
              )
                .toFixed(4)
            )
          : undefined,

      latencyEmaMs:
        record.latencyEmaMs,

      lastLatencyMs:
        record.lastLatencyMs,

      lastFailureAt:
        record.lastFailureAt,

      lastSuccessAt:
        record.lastSuccessAt,

      openedAt:
        record.openedAt,

      nextProbeAt:
        record.openedAt
          ? record.openedAt +
            this.cooldownMs
          : undefined,

      probeInFlight:
        record.probeInFlight
    };
  }
}
