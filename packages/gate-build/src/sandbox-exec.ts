/**
 * Minimal sandbox execution surface needed by BuildGateRole. atlas-web supplies
 * a concrete implementation that lazy-connects to E2B per call; tests pass a
 * vi.fn-backed stub. Deliberately defined locally to avoid cross-package
 * coupling with @atlas/gate-visual-quality.
 */
export interface RunCommandInput {
  cmd: string;
  timeoutMs: number;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True iff the command was killed after exceeding timeoutMs. */
  timedOut: boolean;
}

export interface SandboxExec {
  runCommand(input: RunCommandInput): Promise<RunCommandResult>;
}

/** Thrown by SandboxExec implementations when the sandbox is unreachable. */
export class SandboxUnreachableError extends Error {
  override readonly name = "SandboxUnreachableError";
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super(`SandboxExec: sandbox unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.cause = cause;
  }
}
