import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const MEDIA_KINDS_V1 = ["image", "icon", "illustration"] as const;
export const MediaAssetKindSchema = z.enum(MEDIA_KINDS_V1);
export type MediaAssetKind = z.infer<typeof MediaAssetKindSchema>;

export const MediaLicenseStatusSchema = z.enum([
  "generated",
  "user-uploaded",
  "licensed-third-party",
  "public-domain"
]);

const ContentHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{6,64}$/, "contentHash must be sha256:<hex>");

export const MediaAssetSchema = z
  .object({
    kind: z.literal("mediaasset"),
    ...BaseNodeFields,
    mediaKind: MediaAssetKindSchema,
    providerCapability: z.string().optional(),
    generationPrompt: z.string().optional(),
    pathOrUrl: z.string().min(1),
    altText: z.string().min(1),
    licenseStatus: MediaLicenseStatusSchema,
    contentHash: ContentHashSchema,
    personalizationContext: z.string().default("none"),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type MediaAsset = z.infer<typeof MediaAssetSchema>;
