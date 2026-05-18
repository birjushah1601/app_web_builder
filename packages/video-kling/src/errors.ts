export class KlingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KlingError";
  }
}

export class KlingApiError extends KlingError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.name = "KlingApiError";
    if (options?.statusCode !== undefined) this.statusCode = options.statusCode;
  }
  readonly statusCode?: number;
}

export class KlingJobFailedError extends KlingError {
  constructor(jobId: string, message: string) {
    super(`Kling job ${jobId} failed: ${message}`);
    this.name = "KlingJobFailedError";
  }
}

export class KlingCostCapExceededError extends KlingError {
  constructor(projectId: string, capUsd: number, accumulatedUsd: number) {
    super(
      `KlingCostCapExceededError: project ${projectId} has accumulated $${accumulatedUsd.toFixed(2)}, cap $${capUsd.toFixed(2)}`
    );
    this.name = "KlingCostCapExceededError";
  }
}
