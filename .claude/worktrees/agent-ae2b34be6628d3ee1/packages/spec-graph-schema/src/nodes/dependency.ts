import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

const ExactSemverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

export const CveSeveritySchema = z.enum(["none", "low", "medium", "high", "critical"]);

export const CveFindingSchema = z
  .object({
    id: z.string().min(1),
    cvss: z.number().min(0).max(10).optional()
  })
  .strict();

export const CveScanStatusSchema = z
  .object({
    scannedAt: z.string().datetime(),
    severity: CveSeveritySchema,
    findings: z.array(CveFindingSchema).default([])
  })
  .strict();

export const DependencySchema = z
  .object({
    kind: z.literal("dependency"),
    ...BaseNodeFields,
    name: z.string().min(1),
    version: z.string().regex(ExactSemverRe, "version must be an exact semver (no ^ ~ >= ranges)"),
    purpose: z.string().optional(),
    license: z.string().min(1),
    cveScanStatus: CveScanStatusSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Dependency = z.infer<typeof DependencySchema>;
