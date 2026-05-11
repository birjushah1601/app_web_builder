import { isTransient, RateLimitError } from "./errors.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly multiplier: number;
  readonly name: "default" | "none" | "strict";
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  multiplier: 4, // 100, 400, 1600
  name: "default"
};

export const NO_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 0,
  multiplier: 1,
  name: "none"
};

export const STRICT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 200,
  multiplier: 3,
  name: "strict"
};

export interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  hooks: RetryHooks = {}
): Promise<T> {
  const sleep = hooks.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) throw err;
      if (attempt === policy.maxAttempts - 1) break;
      const hinted = err instanceof RateLimitError && err.retryAfterMs !== undefined
        ? err.retryAfterMs
        : policy.baseDelayMs * Math.pow(policy.multiplier, attempt);
      await sleep(hinted);
    }
  }
  throw lastError;
}

export function resolvePolicy(name: "default" | "none" | "strict" | undefined): RetryPolicy {
  switch (name) {
    case "none": return NO_RETRY_POLICY;
    case "strict": return STRICT_RETRY_POLICY;
    default: return DEFAULT_RETRY_POLICY;
  }
}
