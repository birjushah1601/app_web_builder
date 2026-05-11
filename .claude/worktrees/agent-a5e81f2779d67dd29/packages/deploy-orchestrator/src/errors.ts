export class DeployError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeployError";
  }
}

export class ManifestEmissionError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ManifestEmissionError";
  }
}

export class KubernetesApplyError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KubernetesApplyError";
  }
}

export class CloudflareApplyError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CloudflareApplyError";
  }
}

export class ReconcileTimeoutError extends DeployError {
  constructor(deploymentName: string, elapsedMs: number) {
    super(`reconcile of ${deploymentName} did not reach Healthy within ${elapsedMs}ms`);
    this.name = "ReconcileTimeoutError";
  }
}
