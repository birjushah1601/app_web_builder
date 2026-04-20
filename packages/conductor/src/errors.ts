import type { RitualId } from "./dispatch-context.js";

export class RitualEscalatedError extends Error {
  readonly ritualId: RitualId;
  readonly reason: string;
  constructor(ritualId: RitualId, reason: string) {
    super(`ritual ${ritualId} escalated: ${reason}`);
    this.name = "RitualEscalatedError";
    this.ritualId = ritualId;
    this.reason = reason;
  }
}
