import type { RitualEvent } from "@atlas/ritual-engine";
import type { EditClass } from "@atlas/edit-classifier";

export interface LatencySample {
  ritualId: string;
  editClass: EditClass;
  outcome: "done" | "escalated" | "aborted";
  startedAtMs: number;
  completedAtMs: number;
  elapsedMs: number;
}

export interface SamplerOptions {
  onSample(sample: LatencySample): Promise<void>;
}

export class Sampler {
  private inflight = new Map<string, { startedAtMs: number; editClass: EditClass }>();
  private readonly onSample: (s: LatencySample) => Promise<void>;
  constructor(opts: SamplerOptions) { this.onSample = opts.onSample; }

  async onEvent(event: RitualEvent): Promise<void> {
    if (event.type === "ritual.started") {
      this.inflight.set(event.ritualId, {
        startedAtMs: Date.parse(event.ts),
        editClass: event.payload.editClass
      });
      return;
    }
    if (event.type === "ritual.completed") {
      const start = this.inflight.get(event.ritualId);
      if (!start) return;
      this.inflight.delete(event.ritualId);
      const completedAtMs = Date.parse(event.ts);
      await this.onSample({
        ritualId: event.ritualId,
        editClass: start.editClass,
        outcome: event.payload.finalState,
        startedAtMs: start.startedAtMs,
        completedAtMs,
        elapsedMs: completedAtMs - start.startedAtMs
      });
    }
  }

  activeRituals(): number {
    return this.inflight.size;
  }
}
