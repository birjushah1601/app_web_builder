import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const COMPLIANCE_CLASSES_V1 = ["baseline", "GDPR", "HIPAA", "SOC2-lite"] as const;
export const ComplianceClassNameSchema = z.enum(COMPLIANCE_CLASSES_V1);
export type ComplianceClassName = z.infer<typeof ComplianceClassNameSchema>;

export const ComplianceClassScopeSchema = z.enum(["global", "model", "endpoint", "feature"]);

export const ComplianceClassAttestationSchema = z.enum([
  "self-attested",
  "third-party-audited",
  "certified"
]);

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be a YYYY-MM-DD date");

export const ComplianceClassSchema = z
  .object({
    kind: z.literal("compliance"),
    ...BaseNodeFields,
    name: ComplianceClassNameSchema,
    scope: ComplianceClassScopeSchema,
    attestation: ComplianceClassAttestationSchema,
    effectiveDate: IsoDateSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ComplianceClass = z.infer<typeof ComplianceClassSchema>;
