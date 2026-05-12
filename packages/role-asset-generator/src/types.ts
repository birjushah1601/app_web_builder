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
}
