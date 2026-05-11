export interface ProviderErrorOptions {
  transient: boolean;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly transient: boolean;
  readonly cause?: unknown;
  constructor(message: string, options: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.transient = options.transient;
    this.cause = options.cause;
  }
}

export class NetworkError extends ProviderError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { transient: true, cause: options.cause });
    this.name = "NetworkError";
  }
}

export class RateLimitError extends ProviderError {
  readonly retryAfterMs: number | undefined;
  constructor(message: string, options: { retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, { transient: true, cause: options.cause });
    this.name = "RateLimitError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { transient: false, cause: options.cause });
    this.name = "InvalidRequestError";
  }
}

export function isTransient(err: unknown): boolean {
  return err instanceof ProviderError && err.transient === true;
}
