import { z } from "zod";

export const SloKindSchema = z.enum(["availability", "latency"]);
export type SloKind = z.infer<typeof SloKindSchema>;

export const SloDefinitionSchema = z
  .object({
    /** Stable identifier — survives renames of the surface it watches. */
    id: z.string().min(1),
    /** Human-friendly name for dashboards. */
    name: z.string().min(1),
    kind: SloKindSchema,
    /** Target as a fraction in (0, 1]. e.g., 0.999 = 99.9%. */
    target: z.number().gt(0).lte(1),
    /** Rolling window in days. Common: 7, 28, 30. */
    windowDays: z.number().int().positive(),
    /** Optional latency threshold in ms (only meaningful when kind === "latency"). */
    latencyThresholdMs: z.number().positive().optional()
  })
  .strict()
  .superRefine((slo, ctx) => {
    if (slo.kind === "latency" && slo.latencyThresholdMs === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kind=latency requires latencyThresholdMs",
        path: ["latencyThresholdMs"]
      });
    }
    if (slo.kind === "availability" && slo.latencyThresholdMs !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kind=availability must not set latencyThresholdMs",
        path: ["latencyThresholdMs"]
      });
    }
  });
export type SloDefinition = z.infer<typeof SloDefinitionSchema>;

/**
 * Aggregated samples over a time slice. The engine treats these as the source
 * of truth — concrete observability adapters fill them.
 */
export const SloSampleSchema = z
  .object({
    sloId: z.string().min(1),
    /** ISO time at the END of the slice. */
    sliceEndIso: z.string().datetime(),
    /** Total events in the slice. */
    totalCount: z.number().int().nonnegative(),
    /** Events that count as "good" (responded successfully / within latency budget). */
    goodCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.goodCount > s.totalCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "goodCount cannot exceed totalCount",
        path: ["goodCount"]
      });
    }
  });
export type SloSample = z.infer<typeof SloSampleSchema>;
