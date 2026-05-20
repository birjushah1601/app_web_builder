import { z } from "zod";

/** Opaque identifier returned by E2B on provision. */
export const SandboxIdSchema = z.string().min(1).brand("SandboxId");
export type SandboxId = z.infer<typeof SandboxIdSchema>;

/**
 * Aspirational Atlas-managed template names. The repo doesn't ship the
 * Dockerfiles for these — they are the names this codebase would use IF
 * an operator built and registered them on their E2B account. Listed
 * here for documentation; runtime is permissive.
 */
export const KNOWN_ATLAS_TEMPLATES = [
  "atlas-next-ts",
  "atlas-python-fastapi",
  "atlas-react-vite",
  "atlas-astro",
  "atlas-sveltekit",
  "atlas-expo"
] as const;
export type KnownAtlasTemplate = (typeof KNOWN_ATLAS_TEMPLATES)[number];

/**
 * E2B template reference — name OR raw template ID (alphanumeric, e.g.
 * "6f5mwsacoiiqt0qj1bgx"). E2B's SDK accepts either at runtime, so this
 * schema is permissive: any non-empty string. Tools that want the strict
 * known-name list use {@link KNOWN_ATLAS_TEMPLATES}.
 */
export const TemplateIdSchema = z.string().min(1);
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
