/**
 * Thrown when a sandbox id is not found in the in-memory registry
 * (e.g., provision was never called, or the server restarted).
 */
export class SandboxNotFoundError extends Error {
  readonly sandboxId: string;
  constructor(sandboxId: string) {
    super(`SandboxNotFoundError: sandbox ${sandboxId} not found in registry`);
    this.name = "SandboxNotFoundError";
    this.sandboxId = sandboxId;
  }
}

/**
 * Thrown when the E2B SDK fails to provision a sandbox (network, quota, bad template).
 */
export class SandboxProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxProvisionError";
  }
}

/**
 * Thrown by checkSpendCap() when the project has reached its E2B spend ceiling
 * for the current billing month. No new sandboxes can be provisioned until the
 * cap is raised or the month rolls over.
 */
export class SpendCapExceededError extends Error {
  readonly projectId: string;
  readonly capUsd: number;
  readonly accumulatedUsd: number;
  constructor(projectId: string, capUsd: number, accumulatedUsd: number) {
    super(
      `SpendCapExceededError: project ${projectId} has accumulated $${accumulatedUsd.toFixed(2)} ` +
        `against a $${capUsd.toFixed(2)} monthly cap — sandbox provision blocked`
    );
    this.name = "SpendCapExceededError";
    this.projectId = projectId;
    this.capUsd = capUsd;
    this.accumulatedUsd = accumulatedUsd;
  }
}
