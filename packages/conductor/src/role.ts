import { z } from "zod";

/** Minimal EvalFeedback shape threaded by the conductor's eval gate into the
 *  next quality attempt. Structurally compatible with @atlas/eval-runtime's
 *  EvalFeedback — conductor avoids importing eval-runtime directly to prevent
 *  a circular workspace dependency (eval-runtime → conductor → eval-runtime). */
export interface EvalFeedback {
  source: "structural" | "judge";
  promptFragment: string;
  failures?: ReadonlyArray<{ check: string; reason: string }>;
  dimensions?: ReadonlyArray<{ name: string; score: number; rationale: string }>;
}

export const RoleEventSchema = z.object({
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown())
});
export type RoleEvent = z.infer<typeof RoleEventSchema>;

export const RoleOutputSchema = z.object({
  events: z.array(RoleEventSchema),
  diff: z.object({
    kind: z.enum(["none", "patch"]),
    body: z.string().optional()
  })
});
export type RoleOutput = z.infer<typeof RoleOutputSchema>;

export interface RoleInvocation {
  ritualId: string;
  intent: string;
  graphSlice: { bytes: string; hash: string };
  userTurn: string;
  /** Optional artifact produced by an earlier role in the same ritual.
   *  Architect ignores it; Developer reads it as architectArtifact for its
   *  prompt context. Multi-role ritual chains pipe artifacts through here. */
  priorArtifact?: unknown;
  /** Optional snapshot of files that already exist in the project's live
   *  sandbox. The architect consumes this so its plan builds on the
   *  current tree instead of recreating files from scratch. Conductor +
   *  engine pass this through verbatim — they do not interpret the shape. */
  currentFiles?: ReadonlyArray<{ path: string; content?: string }>;
  /** Plan SPU — user-supplied reference imagery threaded from form/refine.
   *  Folded into the architect's priorArtifact by the engine; downstream
   *  Designer reads it for visual conditioning. Conductor + engine pass
   *  this through verbatim — they do not interpret the shape. */
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
  /** Eval gate: feedback from the previous quality attempt's failed eval.
   *  Undefined on the first attempt; populated by the conductor when a
   *  structural or judge eval fails and `shouldRetry` allows a second attempt.
   *  Roles thread this into their prompts to self-correct. */
  evalFeedback?: EvalFeedback;
}

/** Minimal rubric shape expected by the conductor's eval gate.
 *  Structurally compatible with @atlas/eval-runtime's Rubric<TOutput>. */
export interface RoleRubric {
  readonly roleId: string;
  readonly version: string;
  readonly judgeModel?: string;
  structural(output: unknown, inv: RoleInvocation): { passed: boolean; failures?: Array<{ check: string; reason: string }> };
  judge(output: unknown, inv: RoleInvocation, llm: unknown): Promise<{
    passed: boolean;
    score: number;
    dimensions: Array<{ name: string; score: number; rationale: string }>;
    fixableBy: "retry" | "escalate";
    feedback: string;
  }>;
}

export interface Role {
  readonly id: string;
  run(inv: RoleInvocation): Promise<RoleOutput>;
  /** Optional eval rubric. When present and conductor has verdictSink + llm,
   *  the eval gate activates — structural + judge checks wrap each dispatch. */
  readonly rubric?: RoleRubric;
}

// Stub used in tests and for initial end-to-end smoke. Real roles land in D.2–D.5.
export class TestRole implements Role {
  readonly id: string;
  constructor(opts: { roleId: string; onRun?: (inv: RoleInvocation) => Promise<RoleOutput> }) {
    this.id = opts.roleId;
    if (opts.onRun) this.run = opts.onRun;
  }
  async run(inv: RoleInvocation): Promise<RoleOutput> {
    return {
      events: [{ eventType: `${this.id}.ran`, payload: { intent: inv.intent, graphHash: inv.graphSlice.hash } }],
      diff: { kind: "none" }
    };
  }
}
