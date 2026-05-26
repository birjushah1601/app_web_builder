// src/verdict-sink.ts
import type { Verdict } from "./types.js";

export interface VerdictSink {
  write(verdict: Verdict): Promise<void>;
}

/** In-memory implementation for unit tests; production wiring uses EvalVerdictRepo. */
export class InMemoryVerdictSink implements VerdictSink {
  readonly verdicts: Verdict[] = [];
  async write(verdict: Verdict): Promise<void> {
    this.verdicts.push(verdict);
  }
  clear(): void {
    this.verdicts.length = 0;
  }
}
