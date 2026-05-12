import { z } from "zod";

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
}

export interface Role {
  readonly id: string;
  run(inv: RoleInvocation): Promise<RoleOutput>;
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
