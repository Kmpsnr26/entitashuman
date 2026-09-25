import { AiProviderError } from "./types.js";

export type ProviderHealthState = "healthy" | "degraded" | "open" | "half-open" | "unavailable";

export interface ProviderHealth {
  state: ProviderHealthState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  openedAt?: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
}

interface MutableHealth extends ProviderHealth {
  probeInFlight: boolean;
}

export class ProviderCircuitBreaker {
  private readonly health = new Map<string, MutableHealth>();
  private readonly now: () => number;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    now?: () => number
  ) {
    this.now = now ?? Date.now;
  }

  private entry(id: string): MutableHealth {
    let value = this.health.get(id);
    if (!value) {
      value = {
        state: "healthy",
        consecutiveFailures: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        probeInFlight: false
      };
      this.health.set(id, value);
    }
    return value;
  }

  private refresh(value: MutableHealth): void {
    if (
      value.state === "open" &&
      value.openedAt !== undefined &&
      this.now() - value.openedAt >= this.cooldownMs
    ) {
      value.state = "half-open";
      value.probeInFlight = false;
    }
  }

  status(id: string, configured = true): ProviderHealth {
    if (!configured) {
      return {
        state: "unavailable",
        consecutiveFailures: 0,
        totalFailures: 0,
        totalSuccesses: 0
      };
    }

    const value = this.entry(id);
    this.refresh(value);
    const { probeInFlight: _probe, ...safe } = value;
    return { ...safe };
  }

  acquire(id: string): boolean {
    const value = this.entry(id);
    this.refresh(value);

    if (value.state === "open") {
      return false;
    }

    if (value.state === "half-open") {
      if (value.probeInFlight) {
        return false;
      }
      value.probeInFlight = true;
    }

    return true;
  }

  success(id: string): void {
    const value = this.entry(id);
    value.totalSuccesses += 1;
    value.consecutiveFailures = 0;
    value.lastSuccessAt = this.now();
    value.openedAt = undefined;
    value.probeInFlight = false;
    value.state = "healthy";
  }

  failure(id: string, error: unknown): void {
    if (!(error instanceof AiProviderError) || !error.retryable) {
      return;
    }

    const value = this.entry(id);
    value.totalFailures += 1;
    value.consecutiveFailures += 1;
    value.lastFailureAt = this.now();
    value.probeInFlight = false;

    if (
      value.state === "half-open" ||
      value.consecutiveFailures >= this.failureThreshold
    ) {
      value.state = "open";
      value.openedAt = this.now();
      return;
    }

    value.state = "degraded";
  }
}
