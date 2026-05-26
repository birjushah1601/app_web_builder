import { RitualAbortedError, RitualEscalatedError } from "./errors.js";
import type { DispatchContext } from "./dispatch-context.js";
import type { Role, RoleOutput } from "./role.js";
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
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Conductor {
  private readonly classifier: Classifier;
  private readonly roles: Map<string, Role>;
  private readonly sink: CheckpointSink;
  private readonly sliceBuilder: SliceBuilder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isAbortedFn?: (ritualId: string) => boolean;

  constructor(opts: ConductorOptions) {
    this.classifier = opts.classifier;
    this.roles = opts.roles;
    this.sink = opts.checkpointSink;
    this.sliceBuilder = opts.sliceBuilder;
    this.sleep = opts.sleep ?? defaultSleep;
    this.isAbortedFn = opts.isAborted;
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
    const invocation: import("./role.js").RoleInvocation = {
      ritualId: ctx.ritualId as string,
      intent: classification.roleId,
      graphSlice: slice,
      userTurn: ctx.userTurn,
      priorArtifact: options.priorArtifact
    };
    // exactOptionalPropertyTypes — only set currentFiles when actually provided
    // so downstream `=== undefined` checks behave consistently.
    if (options.currentFiles !== undefined) {
      invocation.currentFiles = options.currentFiles;
    }

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
