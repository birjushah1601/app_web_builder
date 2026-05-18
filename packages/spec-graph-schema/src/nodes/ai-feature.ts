import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const AIFeatureCategorySchema = z.enum([
  "summarization",
  "extraction",
  "classification",
  "generation",
  "translation",
  "qa",
  "search",
  "transformation",
  "agent",
  "other"
]);

export const AIModalitySchema = z.enum(["text", "image", "audio", "video", "multimodal"]);

export const AIGroundingSchema = z.enum(["none", "rag", "tool-use", "structured-context"]);

export const AIPersonalizationSchema = z.enum(["none", "session", "account", "cross-account"]);

export const AIPrivacyModeSchema = z.enum(["no-retain", "retain-7d", "retain-30d", "retain-indefinite"]);

export const AICostTierSchema = z.enum(["fast", "standard", "premium"]);

export const AISafetyContractSchema = z
  .object({
    promptInjectionGuard: z.boolean(),
    hallucinationGuard: z.boolean(),
    piiRedaction: z.boolean().optional(),
    contentFilter: z.boolean().optional()
  })
  .strict();
export type AISafetyContract = z.infer<typeof AISafetyContractSchema>;

export const AIFeatureSchema = z
  .object({
    kind: z.literal("aifeature"),
    ...BaseNodeFields,
    name: z.string().min(1),
    category: AIFeatureCategorySchema,
    capabilityContract: z.record(z.string(), z.unknown()),
    inputModality: AIModalitySchema,
    outputModality: AIModalitySchema,
    grounding: AIGroundingSchema,
    personalization: AIPersonalizationSchema,
    privacyMode: AIPrivacyModeSchema,
    safetyContract: AISafetyContractSchema,
    fallbackBehavior: z.string().min(1),
    costTier: AICostTierSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type AIFeature = z.infer<typeof AIFeatureSchema>;
