import { describe, expect, it } from "vitest";
import { i11MediaAssetGeneratedNeedsProvider } from "../../src/invariants/i11-mediaasset-generated-needs-provider.js";
import type { SpecGraph } from "../../src/graph.js";

const baseGraph = (extras: Partial<SpecGraph> = {}): SpecGraph => ({
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: [],
  ...extras
});

describe("i11: generated MediaAsset needs providerCapability", () => {
  it("ok when no generated media", () => {
    const g = baseGraph({
      nodes: {
        "mediaasset:hero": {
          kind: "mediaasset",
          id: "mediaasset:hero",
          mediaKind: "illustration",
          pathOrUrl: "/static/hero.png",
          altText: "Hero",
          licenseStatus: "user-uploaded",
          contentHash: "sha256:abc123",
          personalizationContext: "none"
        }
      } as never
    });
    expect(i11MediaAssetGeneratedNeedsProvider(g)).toEqual([]);
  });

  it("ok when generated media has providerCapability", () => {
    const g = baseGraph({
      nodes: {
        "mediaasset:hero": {
          kind: "mediaasset",
          id: "mediaasset:hero",
          mediaKind: "illustration",
          pathOrUrl: "/static/hero.png",
          altText: "Hero",
          licenseStatus: "generated",
          contentHash: "sha256:abc123",
          personalizationContext: "none",
          providerCapability: "stable-diffusion-xl@1.0"
        }
      } as never
    });
    expect(i11MediaAssetGeneratedNeedsProvider(g)).toEqual([]);
  });

  it("flags generated media missing providerCapability", () => {
    const g = baseGraph({
      nodes: {
        "mediaasset:hero": {
          kind: "mediaasset",
          id: "mediaasset:hero",
          mediaKind: "illustration",
          pathOrUrl: "/static/hero.png",
          altText: "Hero",
          licenseStatus: "generated",
          contentHash: "sha256:abc123",
          personalizationContext: "none"
        }
      } as never
    });
    const issues = i11MediaAssetGeneratedNeedsProvider(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I11_GENERATED_MEDIA_MISSING_PROVIDER");
    expect(issues[0]?.nodeId).toBe("mediaasset:hero");
  });
});
