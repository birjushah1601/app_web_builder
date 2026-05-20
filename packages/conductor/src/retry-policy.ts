export interface DispatchRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  name: "default" | "none" | "strict";
}

export const DEFAULT_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  multiplier: 4,
  name: "default"
};

export const NO_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 0,
  multiplier: 1,
  name: "none"
};

export const STRICT_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 200,
  multiplier: 3,
  name: "strict"
};
