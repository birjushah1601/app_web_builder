import { z } from "zod";

/** Opaque identifier returned by E2B on provision. */
export const SandboxIdSchema = z.string().min(1).brand("SandboxId");
export type SandboxId = z.infer<typeof SandboxIdSchema>;

/** The two Atlas prebuilt E2B templates (from A.1 Compose stack). */
export const TemplateIdSchema = z.enum(["atlas-next-ts", "atlas-python-fastapi"]);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

export const SandboxStatusSchema = z.enum(["provisioning", "running", "terminated", "error"]);
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const SandboxRecordSchema = z.object({
  sandboxId: SandboxIdSchema,
  templateId: TemplateIdSchema,
  projectId: z.string().uuid(),
  provisionedAt: z.string().datetime(),
  status: SandboxStatusSchema,
  previewBaseUrl: z.string().url().optional(),
});
export type SandboxRecord = z.infer<typeof SandboxRecordSchema>;

/** E2B template digest — sourced from env vars pinned per Plan C.2 release pattern. */
export const TemplateDigestSchema = z.object({
  templateId: TemplateIdSchema,
  digest: z.string().min(7),
});
export type TemplateDigest = z.infer<typeof TemplateDigestSchema>;
