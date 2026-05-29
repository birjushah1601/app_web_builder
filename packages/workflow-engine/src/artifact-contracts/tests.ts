import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const SpecResultSchema = z.object({
  file: z.string().min(1),
  targets: z.array(z.string()),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  lastError: z.string().optional()
});

export const TestsArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("tests"),
  framework: z.enum(["vitest", "playwright", "pytest"]),
  specs: z.array(SpecResultSchema),
  coverage: z.object({
    lines: z.number().min(0).max(100),
    branches: z.number().min(0).max(100)
  }).optional()
});

export type TestsArtifact = z.infer<typeof TestsArtifactSchema>;
export type SpecResult = z.infer<typeof SpecResultSchema>;

ArtifactContractRegistry.register("tests", TestsArtifactSchema);
