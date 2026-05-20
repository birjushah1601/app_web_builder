import { z } from "zod";

export const BuildErrorKindSchema = z.enum([
  "compile",
  "type",
  "timeout",
  "sandbox_unreachable",
  "unsupported_stack",
  "internal_error",
  "none"
]);
export type BuildErrorKind = z.infer<typeof BuildErrorKindSchema>;

export const BuildErrorSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  snippet: z.string().optional()
});
export type BuildError = z.infer<typeof BuildErrorSchema>;

export const BuildReportSchema = z.object({
  passed: z.boolean(),
  errorKind: BuildErrorKindSchema,
  template: z.string(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  errors: z.array(BuildErrorSchema),
  rawTail: z.string().optional()
});
export type BuildReport = z.infer<typeof BuildReportSchema>;
