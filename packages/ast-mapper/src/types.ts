import { z } from "zod";

export const AstRangeSchema = z
  .object({
    file: z.string().min(1),
    /** 1-indexed line + column. */
    startLine: z.number().int().positive(),
    startColumn: z.number().int().nonnegative(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().nonnegative()
  })
  .strict();
export type AstRange = z.infer<typeof AstRangeSchema>;

export const NodeAstMappingSchema = z
  .object({
    nodeId: z.string().min(1),
    /** Multiple ranges allowed — a Component may render across imports + JSX. */
    ranges: z.array(AstRangeSchema).nonempty(),
    /** Confidence the mapper has in this map. 1.0 = exact, < 1.0 = heuristic. */
    confidence: z.number().min(0).max(1),
    /** Mapper that produced this entry — for drift attribution. */
    producer: z.string().min(1)
  })
  .strict();
export type NodeAstMapping = z.infer<typeof NodeAstMappingSchema>;

export const AstMapFileSchema = z
  .object({
    /** Schema version of this map file. */
    version: z.literal(1),
    /** Hash of the spec.graph.json this map was generated against. */
    graphHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    generatedAt: z.string().datetime(),
    mappings: z.array(NodeAstMappingSchema)
  })
  .strict();
export type AstMapFile = z.infer<typeof AstMapFileSchema>;

/** A typed graph mutation that the Agree step can convert to a runnable diff. */
export const MutationKindSchema = z.enum([
  "create-node",
  "update-node-field",
  "delete-node",
  "create-edge",
  "delete-edge"
]);
export type MutationKind = z.infer<typeof MutationKindSchema>;

export const MutationProposalSchema = z
  .object({
    kind: MutationKindSchema,
    /** Target node id (for node mutations) or edge id (for edge mutations). */
    targetRef: z.string().min(1),
    /** Field path being modified, for `update-node-field` mutations. */
    fieldPath: z.array(z.string()).optional(),
    /** New value, for create + update mutations. */
    newValue: z.unknown().optional(),
    /** AST ranges affected, for change-impact preview. */
    affectedAstRanges: z.array(AstRangeSchema).default([])
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === "update-node-field" && (!m.fieldPath || m.fieldPath.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "update-node-field requires a non-empty fieldPath",
        path: ["fieldPath"]
      });
    }
    if ((m.kind === "create-node" || m.kind === "update-node-field") && m.newValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${m.kind} requires newValue`,
        path: ["newValue"]
      });
    }
  });
export type MutationProposal = z.infer<typeof MutationProposalSchema>;
