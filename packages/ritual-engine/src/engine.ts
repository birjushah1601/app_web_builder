import { randomUUID } from "node:crypto";
import type { Conductor } from "@atlas/conductor";
import type { EventSink, EditClass, RitualEvent } from "./events.js";
import type { PersonaPreferences } from "./personas.js";
import { applyTransition, isTerminal, type RitualState, type RitualTransition } from "./state.js";
import { applyApproval, type ApprovalDecision } from "./approval.js";
import { enforcePersonaGate, type RiskAccepted } from "./risk-accept.js";

export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
}

export interface StartInput {
  userTurn: string;
  editClass: EditClass;
  projectId: string;
  userId: string;
}

interface RitualRecord {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
}

export class RitualEngine {
  private readonly conductor: Conductor;
  private readonly sink: EventSink;
  private readonly prefs: PersonaPreferences;
  private readonly rituals = new Map<string, RitualRecord>();

  constructor(opts: RitualEngineOptions) {
    this.conductor = opts.conductor;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
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
    this.rituals.get(ritualId)!.artifact = artifact;

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
