import type { GateResult } from "./types.js";

export type ResolutionChoice =
  | { kind: "retry-with-hint"; hint: string }
  | { kind: "undo"; rollback: () => Promise<{ success: boolean }> }
  | {
      kind: "risk-accept";
      acceptRisk: (ritualId: string, event: unknown) => Promise<void>;
      ritualId: string;
      event: unknown;
    };

export type ResolutionResult =
  | (GateResult & { kind: "retried" })
  | { kind: "undone"; success: boolean }
  | { kind: "risk-accepted" };

export class ResolutionFlow {
  private _attempts = 0;
  private readonly maxRetries: number;
  constructor(opts: { maxRetries: number }) {
    this.maxRetries = opts.maxRetries;
  }
  get attempts(): number { return this._attempts; }
  async choose(choice: ResolutionChoice, runner: (input: never) => Promise<GateResult>): Promise<ResolutionResult> {
    if (choice.kind === "retry-with-hint") {
      if (this._attempts >= this.maxRetries) {
        throw new Error(`max retries (${this.maxRetries}) exceeded`);
      }
      this._attempts += 1;
      const r = await runner({} as never);
      return { ...r, kind: "retried" } as ResolutionResult;
    }
    if (choice.kind === "undo") {
      const u = await choice.rollback();
      return { kind: "undone", success: u.success };
    }
    // risk-accept
    await choice.acceptRisk(choice.ritualId, choice.event);
    return { kind: "risk-accepted" };
  }
}
