import type { RitualId } from "./dispatch-context.js";

/** Minimal Verdict shape needed by RoleEvalEscalation. Structurally compatible
 *  with @atlas/eval-runtime's Verdict — conductor avoids importing eval-runtime
 *  directly to prevent a circular workspace dependency (eval-runtime → conductor). */
export interface EvalVerdict {
  layer: "structural" | "judge" | "workflow";
  passed: boolean;
  dimensions?: ReadonlyArray<{ name: string; score: number; rationale: string }>;
  [key: string]: unknown;
}

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

export class RoleEvalEscalation extends Error {
  readonly ritualId: string;
  readonly roleId: string;
  readonly layer: "structural" | "judge";
  readonly verdicts: EvalVerdict[];
  readonly attempts: number;

  constructor(input: {
    ritualId: string;
    roleId: string;
    layer: "structural" | "judge";
    verdicts: EvalVerdict[];
    attempts: number;
  }) {
    const dims = input.verdicts[input.verdicts.length - 1]?.dimensions
      ?.filter((d) => d.score < 6)
      .map((d) => `${d.name}=${d.score}/10`)
      .join(", ");
    super(`role ${input.roleId} failed ${input.layer} eval after ${input.attempts} attempts${dims ? ` (${dims})` : ""}`);
    this.name = "RoleEvalEscalation";
    this.ritualId = input.ritualId;
    this.roleId = input.roleId;
    this.layer = input.layer;
    this.verdicts = input.verdicts;
    this.attempts = input.attempts;
  }
}
