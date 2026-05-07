import { z } from "zod";

const HEX = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "must be a hex color like #0a0a0a");

export const DesignTokensSchema = z.object({
  palette: z.object({
    primary: HEX,
    accent: HEX,
    surface: HEX,
    text: HEX,
    muted: HEX
  }),
  typeScale: z.object({
    sansFamily: z.string().min(1),
    serifFamily: z.string().min(1).optional(),
    monoFamily: z.string().min(1),
    baseSizePx: z.number().int().min(12).max(24),
    scale: z.enum(["minor-third", "major-third", "perfect-fourth"])
  }),
  density: z.enum(["compact", "comfortable", "spacious"]),
  componentSet: z.enum(["shadcn", "radix-bare", "custom"]),
  imageryStrategy: z.enum(["photo", "illustration", "abstract-gradients", "none"]),
  copyVoice: z.enum(["premium", "friendly", "authoritative", "playful"])
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

export const DesignDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortDescription: z.string().min(1),
  technicalDescription: z.string().min(1),
  citedReferences: z.array(z.string()),
  tokens: DesignTokensSchema
});
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
