import { describe, expect, it } from "vitest";
import { MediaAssetSchema } from "../../src/nodes/media-asset.js";

const valid = {
  kind: "mediaasset" as const,
  id: "mediaasset:hero-illustration",
  mediaKind: "illustration",
  providerCapability: "stable-diffusion-xl@1.0",
  generationPrompt: "Hero illustration of a builder",
  pathOrUrl: "/static/hero.png",
  altText: "A builder assembling blocks",
  licenseStatus: "generated",
  contentHash: "sha256:abc123",
  personalizationContext: "none"
};

describe("MediaAssetSchema", () => {
  it("accepts a v1 mediaKind (image, icon, illustration)", () => {
    for (const kind of ["image", "icon", "illustration"]) {
      expect(() => MediaAssetSchema.parse({ ...valid, mediaKind: kind })).not.toThrow();
    }
  });
  it("rejects deferred kinds (video, audio)", () => {
    for (const kind of ["video", "audio"]) {
      expect(() => MediaAssetSchema.parse({ ...valid, mediaKind: kind })).toThrow();
    }
  });
  it("rejects unknown licenseStatus", () => {
    expect(() => MediaAssetSchema.parse({ ...valid, licenseStatus: "stolen" })).toThrow();
  });
  it("contentHash must look like sha256:<hex>", () => {
    expect(() => MediaAssetSchema.parse({ ...valid, contentHash: "md5:abc" })).toThrow();
  });
});
