import { RitualAbortedError, RitualEscalatedError, RoleEvalEscalation, type EvalVerdict } from "./errors.js";
import type { DispatchContext } from "./dispatch-context.js";
import type { Role, RoleOutput, EvalFeedback } from "./role.js";
import { DEFAULT_DISPATCH_RETRY, type DispatchRetryPolicy } from "./retry-policy.js";

export interface ClassifierResult {
  roleId: string;
  confidence: number;
}

export interface Classifier {
  classify(userTurn: string): Promise<ClassifierResult>;
}

export interface CheckpointEvent {
  eventType: string;
  ritualId: string;
  payload: Record<string, unknown>;
  ts: string;
}

export interface CheckpointSink {
  emit(event: CheckpointEvent): Promise<void>;
}

export interface SliceBuilder {
  (ctx: DispatchContext): { bytes: string; hash: string };
}

/** Minimal VerdictSink interface — structurally compatible with @atlas/eval-runtime's
 *  VerdictSink. Defined here to avoid a circular workspace dependency. */
export interface VerdictSink {
  write(verdict: EvalVerdict): Promise<void>;
}

export interface ConductorOptions {
  classifier: Classifier;
  roles: Map<string, Role>;
  checkpointSink: CheckpointSink;
  sliceBuilder: SliceBuilder;
  sleep?: (ms: number) => Promise<void>;
  /** Plan A: optional callback injected by RitualEngine.abort(). When
   *  truthy, the conductor checks before each role attempt and throws
   *  RitualAbortedError so the ritual unwinds cleanly without retrying. */
  isAborted?: (ritualId: string) => boolean;
  /** Eval gate: when provided, verdicts are persisted via this sink and the
   *  eval gate activates for roles that have a rubric. When absent, eval is
   *  disabled (back-compat — no change to dispatch behaviour). */
  verdictSink?: VerdictSink;
  /** LLM provider for judge calls. Required when verdictSink is provided and
   *  roles have rubrics with judge steps. */
  llm?: unknown;
}

export interface DispatchResult {
  roleId: string;
  output: RoleOutput;
  attempts: number;
}

export interface DispatchOptions {
  retry?: DispatchRetryPolicy;
  /** Bypass the classifier and force dispatch to this role. Used when the
   *  caller already knows which role should run (e.g. a ritual chain that
   *  has just finished architect and is now invoking developer). */
  forceRoleId?: string;
  /** Pass-through to RoleInvocation.priorArtifact — the artifact produced
   *  by a previous role in the same ritual. Optional. */
  priorArtifact?: unknown;
  /** Pass-through to RoleInvocation.currentFiles — a snapshot of files that
   *  exist in the project's live sandbox today. Architect consumes this so
   *  its plan builds on the current tree rather than recreating from scratch.
   *  Optional; conductor doesn't interpret the shape. */
  currentFiles?: ReadonlyArray<{ path: string; content?: string }>;
  /** User ID for eval verdict persistence. Threaded into Verdict.userId.
   *  If absent, falls back to the placeholder "(unknown)" so the NOT NULL
   *  constraint in eval_verdicts is satisfied. */
  userId?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Number of quality retry attempts allowed by the eval gate. */
const EVAL_QUALITY_BUDGET = 2;
/** Pass threshold for judge dimensions (score must be >= this to pass). */
const JUDGE_PASS_THRESHOLD = 6;

export class Conductor {
  private readonly classifier: Classifier;
  private readonly roles: Map<string, Role>;
  private readonly sink: CheckpointSink;
  private readonly sliceBuilder: SliceBuilder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isAbortedFn?: (ritualId: string) => boolean;
  private readonly verdictSink?: VerdictSink;
  private readonly llm?: unknown;

  constructor(opts: ConductorOptions) {
    this.classifier = opts.classifier;
    this.roles = opts.roles;
    this.sink = opts.checkpointSink;
    this.sliceBuilder = opts.sliceBuilder;
    this.sleep = opts.sleep ?? defaultSleep;
    this.isAbortedFn = opts.isAborted;
    this.verdictSink = opts.verdictSink;
    this.llm = opts.llm;
  }

  /** Plan SPU — true when the role registry has a role registered under `id`.
   *  Lets callers (RitualEngine) avoid dispatching a role that's missing so
   *  they can branch cleanly instead of catching an "unknown role" throw. */
  hasRole(id: string): boolean {
    return this.roles.has(id);
  }

  /** Plan A follow-up F6 — public role registration to replace direct .roles.set()
   *  access. Used by atlas-web's factory to plug in workflow-planner + future
   *  workflow roles after the Conductor has been constructed. Idempotent on
   *  the same id — last write wins, matching the existing constructor behavior. */
  registerRole(id: string, role: Role): void {
    this.roles.set(id, role);
  }

  async dispatch(ctx: DispatchContext, options: DispatchOptions = {}): Promise<DispatchResult> {
    const policy = options.retry ?? DEFAULT_DISPATCH_RETRY;
    // forceRoleId bypasses the classifier (used when chaining roles in a
    // multi-step ritual — e.g. RitualEngine.start dispatches architect via
    // the classifier, then dispatches developer with forceRoleId="developer").
    const classification = options.forceRoleId
      ? { roleId: options.forceRoleId, confidence: 1, source: "forced" as const }
      : { ...(await this.classifier.classify(ctx.userTurn)), source: "classified" as const };
    await this.emit({ eventType: "dispatch.classified", ctx, payload: { ...classification } });
    const role = this.roles.get(classification.roleId);
    if (!role) {
      await this.emit({ eventType: "dispatch.failed", ctx, payload: { reason: "unknown-role", roleId: classification.roleId } });
      throw new Error(`unknown role: ${classification.roleId}`);
    }

    const slice = this.sliceBuilder(ctx);
    const baseInvocation: import("./role.js").RoleInvocation = {
      ritualId: ctx.ritualId as string,
      intent: classification.roleId,
      graphSlice: slice,
      userTurn: ctx.userTurn,
      priorArtifact: options.priorArtifact
    };
    // exactOptionalPropertyTypes — only set currentFiles when actually provided
    // so downstream `=== undefined` checks behave consistently.
    if (options.currentFiles !== undefined) {
      baseInvocation.currentFiles = options.currentFiles;
    }

    // Eval gate: when verdictSink is set and role has a rubric, wrap the
    // transient-retry dispatch in a quality-retry loop (max EVAL_QUALITY_BUDGET
    // attempts). Absent verdictSink or absent rubric → skip gate entirely
    // (back-compat: zero change to existing dispatch behaviour).
    if (this.verdictSink && role.rubric) {
      return this.dispatchWithEvalGate(ctx, role, baseInvocation, policy, options);
    }

    return this.runWithTransientRetries(ctx, role, baseInvocation, policy);
  }

  /** Quality-retry loop wrapping the transient-retry dispatch. Only called when
   *  verdictSink + role.rubric are both present. */
  private async dispatchWithEvalGate(
    ctx: DispatchContext,
    role: Role,
    baseInvocation: import("./role.js").RoleInvocation,
    policy: DispatchRetryPolicy,
    options: DispatchOptions
  ): Promise<DispatchResult> {
    const rubric = role.rubric!;
    const userId = options.userId ?? "(unknown)";
    const collectedVerdicts: EvalVerdict[] = [];

    let evalFeedback: EvalFeedback | undefined = undefined;

    for (let qualityAttempt = 1; qualityAttempt <= EVAL_QUALITY_BUDGET; qualityAttempt++) {
      // Build per-quality-attempt invocation with the feedback from previous failure.
      const invocation: import("./role.js").RoleInvocation = { ...baseInvocation };
      if (evalFeedback !== undefined) {
        invocation.evalFeedback = evalFeedback;
      }

      // Run the role (with transient retries for network/parse errors).
      const result = await this.runWithTransientRetries(ctx, role, invocation, policy);

      // --- Structural check ---
      const structuralResult = rubric.structural(result.output, invocation);
      const structuralVerdict = buildStructuralVerdict(structuralResult, qualityAttempt, role, invocation, userId, rubric, evalFeedback, ctx.projectId);
      collectedVerdicts.push(structuralVerdict);
      await this.verdictSink!.write(structuralVerdict);

      if (!structuralResult.passed) {
        const canRetry = qualityAttempt < EVAL_QUALITY_BUDGET;
        if (canRetry) {
          // Build feedback for next attempt and continue.
          evalFeedback = buildStructuralEvalFeedback(structuralResult);
          await this.emit({
            eventType: "role.eval_retry",
            ctx,
            payload: { roleId: role.id, qualityAttempt, layer: "structural", reason: "structural_failed" }
          });
          continue;
        }
        // Second failure — escalate.
        await this.emit({
          eventType: "role.eval_escalated",
          ctx,
          payload: { roleId: role.id, qualityAttempts: qualityAttempt, layer: "structural" }
        });
        throw new RoleEvalEscalation({
          ritualId: ctx.ritualId as string,
          roleId: role.id,
          layer: "structural",
          verdicts: collectedVerdicts,
          attempts: qualityAttempt
        });
      }

      // Structural passed — run judge (fail-fast: skip judge when structural fails).
      const judgeResult = await rubric.judge(result.output, invocation, this.llm);
      const judgeVerdict = buildJudgeVerdict(judgeResult, qualityAttempt, role, invocation, userId, rubric, evalFeedback, ctx.projectId);
      collectedVerdicts.push(judgeVerdict);
      await this.verdictSink!.write(judgeVerdict);

      if (!judgeResult.passed) {
        const canRetry = qualityAttempt < EVAL_QUALITY_BUDGET && judgeResult.fixableBy === "retry";
        if (canRetry) {
          evalFeedback = buildJudgeEvalFeedback(judgeResult);
          await this.emit({
            eventType: "role.eval_retry",
            ctx,
            payload: { roleId: role.id, qualityAttempt, layer: "judge", fixableBy: judgeResult.fixableBy }
          });
          continue;
        }
        // Not retryable (fixableBy=escalate) or exhausted budget.
        await this.emit({
          eventType: "role.eval_escalated",
          ctx,
          payload: { roleId: role.id, qualityAttempts: qualityAttempt, layer: "judge" }
        });
        throw new RoleEvalEscalation({
          ritualId: ctx.ritualId as string,
          roleId: role.id,
          layer: "judge",
          verdicts: collectedVerdicts,
          attempts: qualityAttempt
        });
      }

      // Both structural and judge passed.
      return result;
    }

    // Unreachable (loop always returns or throws), but TypeScript needs a return.
    /* istanbul ignore next */
    throw new Error("eval gate: exhausted quality budget without decision");
  }

  /** The existing transient-retry loop, extracted to a private method so the
   *  eval gate can call it per quality attempt. */
  private async runWithTransientRetries(
    ctx: DispatchContext,
    role: Role,
    invocation: import("./role.js").RoleInvocation,
    policy: DispatchRetryPolicy
  ): Promise<DispatchResult> {
    // Per-attempt LLM timeout. Without this a stuck OpenRouter call (e.g.
    // Llama 3.3 cold-start, provider hanging) blocks the Server Action
    // forever and the user sees "stuck on architecture" with zero feedback.
    // Configurable via ATLAS_ROLE_TIMEOUT_MS; defaults to 180s — long
    // enough for Sonnet/Llama on a full-context architect prompt, short
    // enough that a hang surfaces as a role.failed instead of forever.
    const timeoutMs = Number(process.env.ATLAS_ROLE_TIMEOUT_MS ?? "180000");

    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      // Plan A: check abort flag before each attempt. If the ritual has been
      // aborted, throw RitualAbortedError immediately so the engine unwinds
      // cleanly without making another LLM call.
      if (this.isAbortedFn?.(ctx.ritualId as string)) {
        throw new RitualAbortedError(ctx.ritualId as string, "ritual aborted");
      }
      // Emit BEFORE the role.run so the dev log shows which role is in
      // flight while the LLM call is pending. The conductor previously
      // logged nothing between dispatch.classified and role.run's return,
      // so a hung LLM looked identical to "nothing is happening".
      await this.emit({
        eventType: "role.started",
        ctx,
        payload: { roleId: role.id, attempt, timeoutMs }
      });
      try {
        const output = await Promise.race<import("./role.js").RoleOutput>([
          role.run(invocation),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`role ${role.id} timed out after ${timeoutMs}ms`)),
              timeoutMs
            )
          )
        ]);
        for (const evt of output.events) {
          await this.emit({
            eventType: evt.eventType,
            ctx,
            payload: { ...evt.payload, attempt, roleId: role.id }
          });
        }
        await this.emit({ eventType: "dispatch.completed", ctx, payload: { roleId: role.id, attempts: attempt } });
        return { roleId: role.id, output, attempts: attempt };
      } catch (err) {
        lastError = err;
        await this.emit({
          eventType: "role.failed",
          ctx,
          payload: { roleId: role.id, attempt, message: (err as Error).message }
        });
        if (attempt === policy.maxAttempts) break;
        const delay = policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 1);
        await this.sleep(delay);
      }
    }

    await this.emit({
      eventType: "ritual.escalated",
      ctx,
      payload: { roleId: role.id, attempts: policy.maxAttempts, finalError: (lastError as Error | undefined)?.message }
    });
    throw new RitualEscalatedError(
      ctx.ritualId,
      `role ${role.id} failed ${policy.maxAttempts} times`,
      lastError instanceof Error ? lastError : undefined
    );
  }

  private async emit(input: { eventType: string; ctx: DispatchContext; payload: Record<string, unknown> }): Promise<void> {
    await this.sink.emit({
      eventType: input.eventType,
      ritualId: input.ctx.ritualId as string,
      payload: input.payload,
      ts: new Date().toISOString()
    });
  }
}

// ---------------------------------------------------------------------------
// Eval gate private helpers — pure functions that assemble Verdict shapes from
// rubric outputs. Defined outside the class for easier unit testing.
// ---------------------------------------------------------------------------

function buildStructuralVerdict(
  structural: { passed: boolean; failures?: Array<{ check: string; reason: string }> },
  attempt: number,
  role: Role,
  inv: import("./role.js").RoleInvocation,
  userId: string,
  rubric: import("./role.js").RoleRubric,
  feedbackUsed: EvalFeedback | undefined,
  projectId: string
): EvalVerdict {
  return {
    ritualId: inv.ritualId,
    roleId: role.id,
    projectId,
    userId,
    attempt,
    layer: "structural",
    passed: structural.passed,
    failures: structural.failures,
    feedbackUsed: feedbackUsed as unknown,
    rubricVersion: rubric.version
  };
}

function buildJudgeVerdict(
  judge: {
    passed: boolean;
    score: number;
    dimensions: Array<{ name: string; score: number; rationale: string }>;
    fixableBy: "retry" | "escalate";
    feedback: string;
  },
  attempt: number,
  role: Role,
  inv: import("./role.js").RoleInvocation,
  userId: string,
  rubric: import("./role.js").RoleRubric,
  feedbackUsed: EvalFeedback | undefined,
  projectId: string
): EvalVerdict {
  return {
    ritualId: inv.ritualId,
    roleId: role.id,
    projectId,
    userId,
    attempt,
    layer: "judge",
    passed: judge.passed,
    score: judge.score,
    dimensions: judge.dimensions,
    fixableBy: judge.fixableBy,
    feedbackUsed: feedbackUsed as unknown,
    rubricVersion: rubric.version,
    judgeModel: rubric.judgeModel
  };
}

/** Build EvalFeedback from a failed structural check. Inlined to avoid
 *  importing @atlas/eval-runtime (which already depends on @atlas/conductor). */
function buildStructuralEvalFeedback(
  result: { passed: boolean; failures?: Array<{ check: string; reason: string }> }
): EvalFeedback {
  if (result.passed || !result.failures?.length) {
    throw new Error("buildStructuralEvalFeedback called on passed result");
  }
  const lines = result.failures.map((f) => `- ${f.check}: ${f.reason}`);
  return {
    source: "structural",
    promptFragment: `## Previous-attempt feedback\nYour previous output failed these structural checks:\n${lines.join("\n")}\nAddress each point. Do not repeat the same gap.`,
    failures: result.failures
  };
}

/** Build EvalFeedback from a failed judge result. Inlined to avoid importing
 *  @atlas/eval-runtime (which already depends on @atlas/conductor). */
function buildJudgeEvalFeedback(
  result: {
    passed: boolean;
    score: number;
    dimensions: Array<{ name: string; score: number; rationale: string }>;
    fixableBy: "retry" | "escalate";
    feedback: string;
  }
): EvalFeedback {
  const failed = result.dimensions.filter((d) => d.score < JUDGE_PASS_THRESHOLD);
  const lines = failed.map((d) => `- ${d.name} (${d.score}/10): ${d.rationale}`);
  const tail = result.feedback ? `\n\nJudge guidance: ${result.feedback}` : "";
  return {
    source: "judge",
    promptFragment: `## Previous-attempt feedback\nYour previous output failed these quality dimensions:\n${lines.join("\n")}${tail}\nAddress each dimension. Do not repeat the same gap.`,
    dimensions: failed
  };
}
