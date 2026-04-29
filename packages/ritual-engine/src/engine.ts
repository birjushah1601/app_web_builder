import { randomUUID } from "node:crypto";
import type { Conductor } from "@atlas/conductor";
import type { EventSink, EditClass, RitualEvent } from "./events.js";
import type { PersonaPreferences } from "./personas.js";
import { applyTransition, isTerminal, type RitualState, type RitualTransition } from "./state.js";
import { applyApproval, type ApprovalDecision } from "./approval.js";
import { enforcePersonaGate, type RiskAccepted } from "./risk-accept.js";
import type { RitualHydrator } from "./hydrator.js";

export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
  sandboxApplier?: SandboxApplier;
  /** Plan H: optional fallback for getRitual on in-memory miss.
   *  When omitted, getRitual returns undefined for unknown IDs (today's behavior). */
  hydrator?: RitualHydrator;
  /** Plan I: ordered list of role IDs to dispatch after a successful
   *  developer pass (when developerOutput.diff is non-empty). Each role
   *  is dispatched via Conductor.dispatch({ forceRoleId, priorArtifact }).
   *  A gate-failing role (report.passed === false) escalates the ritual
   *  and stops the chain. Default [] preserves today's architect→developer-only flow. */
  postDeveloperChain?: string[];
}

export interface StartInput {
  userTurn: string;
  editClass: EditClass;
  projectId: string;
  userId: string;
}

/** Events emitted by the role during dispatch. Plain JSON-serializable; safe
 *  to return across the RSC boundary so client code can render them. */
export interface RoleEventRecord {
  eventType: string;
  payload: unknown;
}

/** What the developer role produced when the architect handoff chained into
 *  it. The diff is a unified-diff patch the developer wants applied to the
 *  project's source tree; summary is the developer's plain-language description.
 *  Plan C (not yet built) will apply the diff to the running E2B sandbox. */
export interface DeveloperOutputRecord {
  diff: string;
  summary?: string;
}

/** Aggregate result of writing a developer's diff into the project's
 *  sandbox. Mirrors apps/atlas-web/lib/sandbox/apply-diff-types.ts so
 *  that snapshot consumers (Server Action, ChatPanel) get the same
 *  shape on both sides without round-tripping through `unknown`. */
export interface SandboxApplyResult {
  ok: boolean;
  parsed: number;
  written: number;
  failed: number;
  skipped: number;
  files: Array<{
    path: string;
    status: "written" | "skipped" | "failed";
    reason?: string;
    bytesWritten?: number;
  }>;
  parseError?: string;
}

/** Optional injection on RitualEngineOptions. Implementations live
 *  outside the engine package (atlas-web wires the real adapter via
 *  E2B; engine tests can stub or omit). When omitted, start() skips
 *  the apply step entirely — backward-compatible with existing tests. */
export interface SandboxApplier {
  apply(projectId: string, diff: string): Promise<SandboxApplyResult>;
}

interface RitualRecord {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  /** Full list of role events from the most recent dispatch on this ritual.
   *  Populated by start(); preserved for the lifetime of the in-memory record.
   *  Used by callers (UI) that need to surface what the role produced beyond
   *  just the final artifact (e.g. blocking questions from triage). */
  roleEvents?: RoleEventRecord[];
  /** Set when the developer role chained successfully after architect. */
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
  /** Plan I: present when SecurityRole ran in the post-developer chain. */
  securityReport?: unknown;
  /** Plan I: present when AccessibilityRole ran in the post-developer chain. */
  accessibilityReport?: unknown;
}

/** Read-only view of a ritual's persisted state. Returned by getRitual(). */
export interface RitualSnapshot {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  roleEvents: RoleEventRecord[];
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
  /** Plan I: present when SecurityRole ran. The role's full report.
   *  passed=false means a critical issue → ritual.escalated. */
  securityReport?: unknown;
  /** Plan I: present when AccessibilityRole ran. Same shape contract. */
  accessibilityReport?: unknown;
}

export class RitualEngine {
  private readonly conductor: Conductor;
  private readonly sink: EventSink;
  private readonly prefs: PersonaPreferences;
  private readonly applier?: SandboxApplier;
  private readonly hydrator?: RitualHydrator;
  private readonly postDeveloperChain: readonly string[];
  private readonly rituals = new Map<string, RitualRecord>();

  constructor(opts: RitualEngineOptions) {
    this.conductor = opts.conductor;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
    this.applier = opts.sandboxApplier;
    this.postDeveloperChain = opts.postDeveloperChain ?? [];
    this.hydrator = opts.hydrator;
  }

  async start(input: StartInput): Promise<string> {
    const ritualId = `r-${randomUUID()}`;
    this.rituals.set(ritualId, { state: "visualize", projectId: input.projectId, userId: input.userId });
    await this.emit({
      type: "ritual.started",
      ritualId,
      ts: new Date().toISOString(),
      payload: {
        intent: input.userTurn,
        editClass: input.editClass,
        projectId: input.projectId,
        userId: input.userId
      }
    });

    // Dispatch Architect role for the Visualize step.
    // ritualId is cast to RitualId via the brand-bypass below; Conductor's
    // RitualIdSchema expects a branded string, but the brand is purely a
    // compile-time tag — the runtime value is just the string we generated.
    const result = await this.conductor.dispatch({
      ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
      graphVersion: 0,
      userTurn: input.userTurn,
      projectId: input.projectId
    });

    // Pull the artifact from the role's pass2.completed event (D.2 contract)
    const completed = result.output.events.find((e) => e.eventType.endsWith(".pass2.completed"));
    const artifact = (completed?.payload as { artifact?: unknown } | undefined)?.artifact;
    const record = this.rituals.get(ritualId)!;
    record.artifact = artifact;
    // Capture every role event so callers can introspect what the role
    // produced (e.g. ambiguity questions when triage blocked, intermediate
    // started/failed events for diagnostic UIs).
    record.roleEvents = result.output.events.map((e) => ({
      eventType: e.eventType,
      payload: e.payload as unknown
    }));

    // Plan B: chain into the developer role when:
    //   - architect produced an artifact (triage passed + pass2 ran)
    //   - the conductor has a "developer" role registered
    //   - the edit class isn't cosmetic (cosmetic edits skip code-gen)
    // Failures inside the developer dispatch are caught and recorded into
    // roleEvents but do NOT throw — we still want to surface the architect
    // plan + the developer-failure reason to the user, not a 500.
    if (artifact && input.editClass !== "cosmetic") {
      try {
        const devResult = await this.conductor.dispatch(
          {
            ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
            graphVersion: 0,
            userTurn: input.userTurn,
            projectId: input.projectId
          },
          { forceRoleId: "developer", priorArtifact: artifact }
        );
        record.developerOutput = (devResult.output.diff.kind === "patch")
          ? { diff: devResult.output.diff.body ?? "", summary: extractDeveloperSummary(devResult.output.events) }
          : undefined;
        record.roleEvents = [
          ...(record.roleEvents ?? []),
          ...devResult.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))
        ];

        // Plan C: write the diff into the live preview sandbox if an
        // applier is configured. Failures inside apply are captured into
        // the snapshot — never re-thrown — so the architect plan and
        // developer diff still surface to the user.
        if (this.applier && devResult.output.diff.kind === "patch" && devResult.output.diff.body) {
          try {
            const applyResult = await this.applier.apply(input.projectId, devResult.output.diff.body);
            record.sandboxApplyResult = applyResult;
          } catch (err) {
            record.sandboxApplyResult = {
              ok: false, parsed: 0, written: 0, failed: 0, skipped: 0,
              files: [], parseError: `applier threw: ${err instanceof Error ? err.message : String(err)}`
            };
          }
        }

        // Plan I: post-developer chain (Security → Accessibility per factory
        // config). Runs only when developer produced a real diff. A
        // gate-failing role (report.passed === false) escalates the ritual
        // and stops the chain. Empty chain = today's behavior.
        if (
          record.developerOutput?.diff &&
          this.postDeveloperChain.length > 0
        ) {
          for (const roleId of this.postDeveloperChain) {
            try {
              const chainResult = await this.conductor.dispatch(
                {
                  ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
                  graphVersion: 0,
                  userTurn: record.developerOutput.diff,
                  projectId: input.projectId
                },
                { forceRoleId: roleId, priorArtifact: record.developerOutput }
              );

              record.roleEvents = [
                ...(record.roleEvents ?? []),
                ...chainResult.output.events.map((e) => ({
                  eventType: e.eventType,
                  payload: e.payload as unknown
                }))
              ];

              const completed = chainResult.output.events.find(
                (e) => e.eventType === `${roleId}.completed`
              );
              const payload = completed?.payload as
                | { passed?: boolean; report?: unknown }
                | undefined;

              if (roleId === "security") {
                record.securityReport = payload?.report;
              } else if (roleId === "accessibility") {
                record.accessibilityReport = payload?.report;
              }

              if (payload?.passed === false) {
                record.state = "escalated";
                // Use the existing ritual.escalation_requested event shape
                // — its payload is { reason, requestedBy }. Encode the
                // gate ID + report into reason (JSON-stringified) so
                // downstream consumers can recover the structured info.
                const gateLabel = roleId === "security" ? "L4-security" : "L5-compliance";
                await this.emit({
                  type: "ritual.escalation_requested",
                  ritualId,
                  ts: new Date().toISOString(),
                  payload: {
                    reason: `${gateLabel}-gate-failed: ${JSON.stringify(payload.report)}`,
                    requestedBy: roleId
                  }
                });
                break;
              }
            } catch (err) {
              // Chain dispatch failure (unknown-role, provider error, etc.)
              // — record a synthetic event and stop the chain. Don't escalate
              // since the underlying gate didn't actually fail.
              record.roleEvents = [
                ...(record.roleEvents ?? []),
                {
                  eventType: `${roleId}.dispatch.failed`,
                  payload: { error: err instanceof Error ? err.message : String(err) }
                }
              ];
              break;
            }
          }
        }
      } catch (err) {
        // unknown-role (developer not registered) or BothProvidersFailedError
        // etc. Record a synthetic event so the UI can show what went wrong
        // without the whole ritual erroring.
        record.roleEvents = [
          ...(record.roleEvents ?? []),
          {
            eventType: "developer.dispatch.failed",
            payload: { error: err instanceof Error ? err.message : String(err) }
          }
        ];
      }
    }

    // Plan I: if the post-developer chain escalated (gate failure), skip
    // the artifact_emitted transition — the ritual is already terminal
    // (state === "escalated"), and applyTransition would throw
    // InvalidTransitionError on a non-escalate transition from a terminal
    // state.
    if (record.state === "escalated") {
      return ritualId;
    }

    await this.emit({
      type: "ritual.artifact_emitted",
      ritualId,
      ts: new Date().toISOString(),
      payload: { fromRole: result.roleId, artifact: artifact ?? null }
    });

    const tx: RitualTransition = input.editClass === "cosmetic"
      ? { kind: "artifact_emitted_cosmetic" }
      : { kind: "artifact_emitted" };
    await this.transition(ritualId, tx);
    return ritualId;
  }

  // Pulls the developer's summary (and ergo signals success) from its
  // emitted events. The .completed event always carries summary; if it's
  // missing, the role didn't reach a winner, and we return undefined.

  /** Read-only snapshot of a ritual's persisted state. Returns undefined if
   *  the ritualId is unknown to this engine instance (engine state is
   *  in-memory; rituals from a previous process are not reachable). */
  async getRitual(ritualId: string): Promise<RitualSnapshot | undefined> {
    const r = this.rituals.get(ritualId);
    if (r) {
      return {
        state: r.state,
        projectId: r.projectId,
        userId: r.userId,
        artifact: r.artifact,
        roleEvents: r.roleEvents ?? [],
        developerOutput: r.developerOutput,
        sandboxApplyResult: r.sandboxApplyResult,
        securityReport: r.securityReport,
        accessibilityReport: r.accessibilityReport
      };
    }
    // Plan H: in-memory miss — fall back to hydrator if configured.
    if (this.hydrator) {
      const hydrated = await this.hydrator.hydrate(ritualId);
      return hydrated ?? undefined;
    }
    return undefined;
  }

  async approve(ritualId: string, decision: ApprovalDecision): Promise<void> {
    const tx = applyApproval(decision);
    await this.transition(ritualId, tx);
    if (decision.kind === "approved") {
      await this.emit({
        type: "ritual.approved",
        ritualId,
        ts: new Date().toISOString(),
        payload: { approvedBy: decision.approvedBy, persona: decision.persona }
      });
    } else {
      await this.emit({
        type: "ritual.changes_requested",
        ritualId,
        ts: new Date().toISOString(),
        payload: { requestedBy: decision.requestedBy, notes: decision.notes }
      });
    }
  }

  async acceptRisk(ritualId: string, event: RiskAccepted): Promise<void> {
    enforcePersonaGate(event); // throws PersonaGateError if disallowed
    await this.emit({
      type: "ritual.risk_accepted",
      ritualId,
      ts: new Date().toISOString(),
      payload: event
    });
  }

  async escalate(ritualId: string, reason: string, requestedBy: string): Promise<void> {
    await this.emit({
      type: "ritual.escalation_requested",
      ritualId,
      ts: new Date().toISOString(),
      payload: { reason, requestedBy }
    });
    await this.transition(ritualId, { kind: "escalate", reason });
  }

  async markBuildComplete(ritualId: string): Promise<void> {
    await this.transition(ritualId, { kind: "merge_gates_green" });
  }

  state(ritualId: string): RitualState {
    const r = this.rituals.get(ritualId);
    if (!r) throw new Error(`unknown ritualId: ${ritualId}`);
    return r.state;
  }

  artifact(ritualId: string): unknown {
    return this.rituals.get(ritualId)?.artifact;
  }

  /** Evict an in-memory ritual record. Call after observing `ritual.completed`
   *  to prevent unbounded growth in long-running processes. Idempotent. */
  dispose(ritualId: string): void {
    this.rituals.delete(ritualId);
  }

  private async transition(ritualId: string, tx: RitualTransition): Promise<void> {
    const record = this.rituals.get(ritualId);
    if (!record) throw new Error(`unknown ritualId: ${ritualId}`);
    const from = record.state;
    const to = applyTransition(from, tx);
    record.state = to;
    await this.emit({
      type: "ritual.transitioned",
      ritualId,
      ts: new Date().toISOString(),
      payload: { from, to, transitionKind: tx.kind }
    });
    if (isTerminal(to)) {
      await this.emit({
        type: "ritual.completed",
        ritualId,
        ts: new Date().toISOString(),
        payload: { finalState: to as "done" | "escalated" | "aborted" }
      });
    }
  }

  private async emit(event: RitualEvent): Promise<void> {
    await this.sink.emit(event);
  }
}

/** Pulls the developer's plain-text summary from its emitted events.
 *  The .completed event carries the winner's summary; if neither completed
 *  nor walkover landed (both providers failed), returns undefined. */
function extractDeveloperSummary(events: ReadonlyArray<{ eventType: string; payload: unknown }>): string | undefined {
  for (const evt of events) {
    if (evt.eventType === "developer.completed") {
      const p = evt.payload as { summary?: unknown };
      if (typeof p.summary === "string") return p.summary;
    }
  }
  return undefined;
}
