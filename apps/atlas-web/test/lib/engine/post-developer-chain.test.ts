import { describe, it, expect } from "vitest";
import { backendArtifactChainTail } from "@/lib/engine/post-developer-chain";

describe("backendArtifactChainTail", () => {
  it("returns [\"backend-artifact\"] for atlas-fastapi", () => {
    expect(backendArtifactChainTail("atlas-fastapi")).toEqual(["backend-artifact"]);
  });

  it("returns [] for atlas-next-ts-v2", () => {
    expect(backendArtifactChainTail("atlas-next-ts-v2")).toEqual([]);
  });

  it("returns [] for an unknown template", () => {
    expect(backendArtifactChainTail("unknown-template")).toEqual([]);
  });

  it("returns [] for undefined template", () => {
    expect(backendArtifactChainTail(undefined)).toEqual([]);
  });
});
