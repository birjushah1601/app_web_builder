import { describe, expect, it } from "vitest";
import { i14MediaAssetKindAllowlistV1 } from "../../src/invariants/i14-mediaasset-kind-allowlist-v1.js";
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

describe("i14: MediaAsset.kind v1 allowlist (defensive)", () => {
  it("ok when mediaKind is a v1 allowlist value", () => {
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
    expect(i14MediaAssetKindAllowlistV1(g)).toEqual([]);
  });

  it("flags mediaKind outside allowlist (e.g. video)", () => {
    const g = baseGraph({
      nodes: {
        "mediaasset:hero": {
          kind: "mediaasset",
          id: "mediaasset:hero",
          mediaKind: "video",
          pathOrUrl: "/static/hero.mp4",
          altText: "Hero",
          licenseStatus: "user-uploaded",
          contentHash: "sha256:abc123",
          personalizationContext: "none"
        } as never
      } as never
    });
    const issues = i14MediaAssetKindAllowlistV1(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I14_MEDIAASSET_KIND_PHASE_B");
    expect(issues[0]?.nodeId).toBe("mediaasset:hero");
  });

  it("ok when no mediaassets", () => {
    const g = baseGraph();
    expect(i14MediaAssetKindAllowlistV1(g)).toEqual([]);
  });
});
