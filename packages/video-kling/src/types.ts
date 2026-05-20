import { z } from "zod";

export const KlingModelSchema = z.enum(["kling-v1", "kling-v1-5", "kling-v2"]);
export type KlingModel = z.infer<typeof KlingModelSchema>;

export const KlingAspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);
export type KlingAspectRatio = z.infer<typeof KlingAspectRatioSchema>;

export const KlingGenerateInputSchema = z
  .object({
    /** Text prompt (required). */
    prompt: z.string().min(1),
    /** Optional negative prompt — things the model should avoid. */
    negativePrompt: z.string().optional(),
    /** Duration in seconds. Kling's hard cap is 10s; Atlas default 5s. */
    durationSec: z.number().int().positive().max(10).default(5),
    /** Aspect ratio. Default 16:9 (web-app hero). */
    aspectRatio: KlingAspectRatioSchema.default("16:9"),
    /** Model id. Default kling-v1-5. */
    model: KlingModelSchema.default("kling-v1-5"),
    /** Optional image URL for image-to-video generation. */
    imageUrl: z.string().url().optional(),
    /** Per-project idempotency key — Kling dedupes repeat requests with the same key. */
    idempotencyKey: z.string().min(1).optional()
  })
  .strict();
export type KlingGenerateInput = z.infer<typeof KlingGenerateInputSchema>;

export const KlingJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type KlingJobStatus = z.infer<typeof KlingJobStatusSchema>;

export const KlingJobSchema = z
  .object({
    jobId: z.string().min(1),
    status: KlingJobStatusSchema,
    /** Populated once status === "succeeded". */
    videoUrl: z.string().url().optional(),
    /** Populated once status === "succeeded". */
    thumbnailUrl: z.string().url().optional(),
    /** Kling's reported duration of the produced clip. */
    actualDurationSec: z.number().positive().optional(),
    /** Populated once status === "failed". */
    errorMessage: z.string().optional(),
    /** Kling's billed usage for this job, as reported by the API. */
    usageUsd: z.number().nonnegative().optional(),
    submittedAtIso: z.string().datetime(),
    updatedAtIso: z.string().datetime()
  })
  .strict();
export type KlingJob = z.infer<typeof KlingJobSchema>;

export const KlingCostCapSchema = z
  .object({
    /** Hard cap in USD per project per calendar month. */
    capUsd: z.number().positive(),
    /** Warn threshold as a fraction in (0, 1]. Default 0.8. */
    warnFraction: z.number().gt(0).lte(1).default(0.8)
  })
  .strict();
export type KlingCostCap = z.infer<typeof KlingCostCapSchema>;
