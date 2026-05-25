import type { RitualId } from "./dispatch-context.js";

export class RitualAbortedError extends Error {
  readonly ritualId: string;
  readonly reason: string;
  constructor(ritualId: string, reason: string) {
    super(`ritual ${ritualId} aborted: ${reason}`);
    this.name = "RitualAbortedError";
    this.ritualId = ritualId;
    this.reason = reason;
  }
}

export class RitualEscalatedError extends Error {
  readonly ritualId: RitualId;
  readonly reason: string;
  /** The role's last thrown error after exhausting retries. Surface its message
   *  in upstream user alerts so operators see *why* the role failed, not just
   *  that it did. Optional for back-compat. */
  readonly lastError?: Error;

  constructor(ritualId: RitualId, reason: string, lastError?: Error) {
    // Inline lastError.message so consumers that only forward .message
    // (Server Action → ChatPanel alert, log lines, etc.) still see the
    // root cause, not just "role X failed N times".
    const causeSuffix = lastError?.message ? `: ${lastError.message}` : "";
    super(`ritual ${ritualId} escalated: ${reason}${causeSuffix}`);
    this.name = "RitualEscalatedError";
    this.ritualId = ritualId;
    this.reason = reason;
    this.lastError = lastError;
    if (lastError) {
      // Standard Error.cause for callers that walk it programmatically.
      (this as Error & { cause?: unknown }).cause = lastError;
    }
  }
}
