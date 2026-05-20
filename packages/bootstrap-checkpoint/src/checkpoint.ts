import type { PersonaPreferences, RitualEvent } from "@atlas/ritual-engine";
import { CANONICAL_ITEMS, type ChecklistItem, type ChecklistResult } from "./checklist.js";
import type { BootstrapEvent } from "./events.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface ChecklistRunner {
  run(items: ChecklistItem[], persona: PersonaTier): Promise<ChecklistResult>;
}

export interface BootstrapCheckpointOptions {
  store: CheckpointStore;
  runner: ChecklistRunner;
  eventSink: { emit(event: BootstrapEvent): Promise<void> };
  personaPreferences: PersonaPreferences;
  ritualEngine?: { approve(ritualId: string, decision: { kind: "changes_requested"; requestedBy: string; notes: string }): Promise<void> };
}

export interface RitualContext {
  projectId: string;
  userId: string;
  rerun?: boolean;
}

export class BootstrapCheckpoint {
  private readonly store: CheckpointStore;
  private readonly runner: ChecklistRunner;
  private readonly sink: { emit(event: BootstrapEvent): Promise<void> };
  private readonly prefs: PersonaPreferences;
  private readonly ritualEngine?: BootstrapCheckpointOptions["ritualEngine"];

  constructor(opts: BootstrapCheckpointOptions) {
    this.store = opts.store;
    this.runner = opts.runner;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
    this.ritualEngine = opts.ritualEngine;
  }

  /** Engine wires every RitualEvent through this method. The checkpoint
   *  inspects only the first transitioned-out-of-visualize event per project. */
  async onRitualEvent(event: RitualEvent, ctx: RitualContext): Promise<void> {
    if (event.type !== "ritual.transitioned") return;
    if (event.payload.from !== "visualize") return;
    if (event.payload.to !== "agree" && event.payload.to !== "build") return;

    if (!ctx.rerun && await this.store.hasPassed(ctx.projectId)) return;

    const ts = new Date().toISOString();
    await this.sink.emit({
      type: "bootstrap.required",
      ritualId: event.ritualId,
      projectId: ctx.projectId,
      ts
    });

    const persona = await this.prefs.getPersona(ctx.userId, ctx.projectId);
    const result = await this.runner.run(CANONICAL_ITEMS, persona);

    if (result.passed) {
      await this.store.markPassed(ctx.projectId, { ts, ritualId: event.ritualId });
      await this.sink.emit({
        type: "bootstrap.passed",
        ritualId: event.ritualId,
        projectId: ctx.projectId,
        ts: new Date().toISOString(),
        payload: { itemKeys: result.itemResults.map((r) => r.key) }
      });
    } else {
      const failed = result.itemResults.filter((r) => !r.passed);
      const notes: Record<string, string> = {};
      for (const r of failed) if (r.notes) notes[r.key] = r.notes;
      await this.sink.emit({
        type: "bootstrap.failed",
        ritualId: event.ritualId,
        projectId: ctx.projectId,
        ts: new Date().toISOString(),
        payload: { failedKeys: failed.map((r) => r.key), notes }
      });

      // Check for intuition_check escape hatch
      const intuition = result.itemResults.find((r) => r.key === "intuition_check");
      if (intuition && !intuition.passed && intuition.notes) {
        await this.sink.emit({
          type: "bootstrap.escalation_requested",
          ritualId: event.ritualId,
          projectId: ctx.projectId,
          ts: new Date().toISOString(),
          payload: { freeText: intuition.notes, requestedReviewer: "priya" }
        });
      }

      if (this.ritualEngine) {
        const notesString = `Bootstrap checkpoint failed on: ${failed.map((r) => r.key).join(", ")}`;
        await this.ritualEngine.approve(event.ritualId, {
          kind: "changes_requested",
          requestedBy: "bootstrap-checkpoint",
          notes: notesString
        });
      }
    }
  }
}
