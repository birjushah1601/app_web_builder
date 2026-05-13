import { z } from "zod";

export const AssetSlotSchema = z.object({
  slot: z.string(),
  url: z.string(),
  prompt: z.string().optional(),
  alt: z.string()
});
export type AssetSlot = z.infer<typeof AssetSlotSchema>;

export const AssetManifestSchema = z.object({
  hero: AssetSlotSchema.optional(),
  sections: z.array(AssetSlotSchema)
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export interface AssetGenInput {
  proposal: unknown; // DesignProposal from role-designer
  brief: unknown;    // InspirationBrief from role-researcher
  projectId: string;
  /** The user's actual prompt ("a luxury real estate site for Skyline Estates").
   *  Without this the image prompt only sees the architect's artifactKind
   *  ("frontend-app") + the designer's generic style description, which
   *  makes gpt-image-1 produce a generic UI mockup rather than a
   *  subject-matter hero photo. Optional for backwards compat; when
   *  present, buildHeroPrompt prepends it as the subject. */
  userTurn?: string;
}
