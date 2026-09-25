export type ProviderHealthState =
  | "healthy"
  | "degraded"
  | "open"
  | "half-open"
  | "unavailable";

export interface ProviderHealthSnapshot {
  state: ProviderHealthState;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  nextProbeAt?: number;
  probeInFlight: boolean;
}

interface ProviderHealthRecord {
  state:
    Exclude<
      ProviderHealthState,
      "unavailable"
    >;
  consecutiveFailures: number;
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
  state: ProviderHealthState;
  probe: boolean;
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
    providerId: string
  ): void {
    const record =
      this.record(
        providerId
      );

    record.state =
      "healthy";

    record.consecutiveFailures =
      0;

    record.lastSuccessAt =
      this.now();

    record.openedAt =
      undefined;

    record.probeInFlight =
      false;
  }

  retryableFailure(
    providerId: string
  ): void {
    const record =
      this.record(
        providerId
      );

    const now =
      this.now();

    record.lastFailureAt =
      now;

    record.consecutiveFailures +=
      1;

    record.probeInFlight =
      false;

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

        consecutiveFailures:
          0,

        probeInFlight:
          false
      };
    }

    const record =
      this.record(
        providerId
      );

    return {
      state:
        record.state,

      consecutiveFailures:
        record
          .consecutiveFailures,

      lastFailureAt:
        record
          .lastFailureAt,

      lastSuccessAt:
        record
          .lastSuccessAt,

      openedAt:
        record
          .openedAt,

      nextProbeAt:
        record.openedAt
          ? record.openedAt +
            this.cooldownMs
          : undefined,

      probeInFlight:
        record
          .probeInFlight
    };
  }
}
