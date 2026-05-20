import { isTransient } from "./errors.js";

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`circuit breaker open for ${key}`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  key: string;
  openAfter: number;
  halfOpenAfterMs: number;
  clock?: { now(): number };
}

type State = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly clock: { now(): number };
  private readonly opts: CircuitBreakerOptions;

  constructor(opts: CircuitBreakerOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? { now: () => Date.now() };
  }

  get state(): State {
    if (this.openedAt === null) return "closed";
    if (this.clock.now() - this.openedAt >= this.opts.halfOpenAfterMs) return "half-open";
    return "open";
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.state;
    if (s === "open") throw new CircuitOpenError(this.opts.key);
    try {
      const result = await fn();
      if (s === "half-open" || this.failures > 0) {
        this.failures = 0;
        this.openedAt = null;
      }
      return result;
    } catch (err) {
      if (s === "half-open") {
        this.openedAt = this.clock.now();
      } else if (isTransient(err)) {
        this.failures += 1;
        if (this.failures >= this.opts.openAfter) {
          this.openedAt = this.clock.now();
        }
      }
      throw err;
    }
  }
}
