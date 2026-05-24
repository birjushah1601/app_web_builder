export interface CanvasOptionResolution {
  directionId: string;
  tokens: unknown;
  autoSelected: boolean;
}

interface RecommendedFallback {
  directionId: string;
  tokens: unknown;
}

interface WaitForOptionInput {
  ritualId: string;
  timeoutMs: number;
  recommendedFallback: RecommendedFallback;
}

/** Plan UXO Task 7 — a single editable plan step. The architect emits its
 *  proposed plan as an array of these; the user edits inline (rename,
 *  delete) and clicks "Approve" which calls resolvePlanApproval with the
 *  final, possibly-trimmed array. */
export interface PlanCheckpoint {
  id: string;
  text: string;
}

/** Plan UXO Task 7 — resolution payload for the plan-approval pause kind.
 *  Carries the final (post-edit) checkpoint list AND a flag indicating
 *  whether the engine auto-approved the original plan because the user
 *  never clicked. Mirrors the option-select kind's `autoSelected`. */
export interface PlanApprovalResolution {
  approvedPlan: ReadonlyArray<PlanCheckpoint>;
  autoApproved: boolean;
}

interface WaitForPlanApprovalInput {
  ritualId: string;
  timeoutMs: number;
  /** The architect's proposed plan. Becomes the auto-approval payload
   *  when the user fails to click within timeoutMs. */
  plan: ReadonlyArray<PlanCheckpoint>;
}

/** Plan U slice 3 — triage clarification pause. The architect's pass-1
 *  emits blocker questions (with optional widget kinds from Plan U slice
 *  2); the engine pauses on this kind, the user answers via the form,
 *  the Server Action calls resolveTriageClarifications, and the engine
 *  resumes architect WITHOUT re-running pass-1 (it already has the
 *  classifications from the first triage). */
export interface TriageClarificationsResolution {
  /** User's answers keyed by question id, or by index when the architect
   *  didn't supply ids. The engine threads these into priorArtifact.
   *  userAnswers so deepPlan can read them deterministically. */
  answers: Readonly<Record<string, string>>;
  autoResolved: boolean;
}

interface WaitForTriageClarificationsInput {
  ritualId: string;
  timeoutMs: number;
  /** Auto-resolve payload — used when the user never clicks within
   *  timeoutMs. Per Plan U: this leaves answers empty, signalling the
   *  engine to fall back to scope-default behavior (treat unanswered
   *  blockers as "use the architect's recommended defaults"). */
  fallbackAnswers: Readonly<Record<string, string>>;
}

/** Discriminated union of pending waiter shapes. The `kind` discriminator
 *  lets a single `waiters` map host both pause types without losing
 *  type-safety at resolve/dispose time. */
type PendingWaiter =
  | {
      kind: "option-select";
      resolve: (r: CanvasOptionResolution) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "plan-approval";
      resolve: (r: PlanApprovalResolution) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "triage-clarifications";
      resolve: (r: TriageClarificationsResolution) => void;
      timer: ReturnType<typeof setTimeout>;
    };

/** Engine-side promise registry. _runRitual awaits waitForOption; a Server
 *  Action's selectDesignDirection call invokes resolveOption on the same
 *  per-request engine instance. Timeout (default 30 min) auto-resolves with
 *  the architect/designer's recommended direction.
 *
 *  Plan UXO Task 7 — additionally supports waitForPlanApproval /
 *  resolvePlanApproval for the editable-plan pause kind. Both kinds share
 *  one `waiters` map keyed by ritualId; a ritual can only be paused on
 *  one kind at a time (the engine drives the pause kind from the role
 *  context, so there is no caller race condition). */
export class CanvasPauseRegistry {
  private readonly waiters = new Map<string, PendingWaiter>();

  waitForOption(input: WaitForOptionInput): Promise<CanvasOptionResolution> {
    return new Promise<CanvasOptionResolution>((resolve) => {
      const timer = setTimeout(() => {
        const existing = this.waiters.get(input.ritualId);
        if (existing && existing.kind === "option-select") {
          this.waiters.delete(input.ritualId);
          resolve({
            directionId: input.recommendedFallback.directionId,
            tokens: input.recommendedFallback.tokens,
            autoSelected: true
          });
        }
      }, input.timeoutMs);
      this.waiters.set(input.ritualId, { kind: "option-select", resolve, timer });
    });
  }

  /** Idempotent: second call for the same ritualId is a no-op so a stale
   *  Server-Action retry can't double-resolve. Also a no-op when the
   *  pending waiter is for a different kind (caller misuse). */
  resolveOption(ritualId: string, payload: { directionId: string; tokens: unknown }): void {
    const w = this.waiters.get(ritualId);
    if (!w || w.kind !== "option-select") return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
    w.resolve({ directionId: payload.directionId, tokens: payload.tokens, autoSelected: false });
  }

  /** Plan UXO Task 7 — await the user's edits + approval of the architect's
   *  proposed plan. Mirrors waitForOption's lifecycle: auto-resolves with
   *  the original plan + autoApproved=true on timeout. */
  waitForPlanApproval(input: WaitForPlanApprovalInput): Promise<PlanApprovalResolution> {
    return new Promise<PlanApprovalResolution>((resolve) => {
      const timer = setTimeout(() => {
        const existing = this.waiters.get(input.ritualId);
        if (existing && existing.kind === "plan-approval") {
          this.waiters.delete(input.ritualId);
          resolve({
            approvedPlan: input.plan,
            autoApproved: true
          });
        }
      }, input.timeoutMs);
      this.waiters.set(input.ritualId, { kind: "plan-approval", resolve, timer });
    });
  }

  /** Plan UXO Task 7 — resolve a plan-approval waiter with the user's
   *  final (post-edit) plan. Same idempotency rules as resolveOption. */
  resolvePlanApproval(ritualId: string, approvedPlan: ReadonlyArray<PlanCheckpoint>): void {
    const w = this.waiters.get(ritualId);
    if (!w || w.kind !== "plan-approval") return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
    w.resolve({ approvedPlan, autoApproved: false });
  }

  /** Plan U slice 3 — await the user's answers to the architect's
   *  triage blocker questions. Mirrors waitForOption's lifecycle:
   *  auto-resolves with empty answers on timeout (engine treats this
   *  as "user disengaged; fall back to scope defaults"). */
  waitForTriageClarifications(input: WaitForTriageClarificationsInput): Promise<TriageClarificationsResolution> {
    return new Promise<TriageClarificationsResolution>((resolve) => {
      const timer = setTimeout(() => {
        const existing = this.waiters.get(input.ritualId);
        if (existing && existing.kind === "triage-clarifications") {
          this.waiters.delete(input.ritualId);
          resolve({
            answers: input.fallbackAnswers,
            autoResolved: true
          });
        }
      }, input.timeoutMs);
      this.waiters.set(input.ritualId, { kind: "triage-clarifications", resolve, timer });
    });
  }

  /** Plan U slice 3 — resolve a triage-clarifications waiter with the
   *  user's answers. Same idempotency rules as resolveOption (second
   *  call for the same ritualId no-ops, and a no-op when the pending
   *  waiter is for a different kind). */
  resolveTriageClarifications(ritualId: string, answers: Readonly<Record<string, string>>): void {
    const w = this.waiters.get(ritualId);
    if (!w || w.kind !== "triage-clarifications") return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
    w.resolve({ answers, autoResolved: false });
  }

  /** Disposes any pending waiter for the ritual regardless of kind. */
  dispose(ritualId: string): void {
    const w = this.waiters.get(ritualId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
  }

  pendingCount(): number {
    return this.waiters.size;
  }
}

/** Default 30-minute pause window per spec ("user never clicks → engine auto-selects"). */
export const DEFAULT_CANVAS_PAUSE_TIMEOUT_MS = 30 * 60 * 1000;
