import { describe, it, expect } from "vitest";
import { buildPostDeveloperChain } from "@/lib/engine/post-developer-chain";

describe("buildPostDeveloperChain", () => {
  it("appends backend-artifact for atlas-fastapi", () => {
    expect(buildPostDeveloperChain("atlas-fastapi")).toEqual(["build-gate", "backend-artifact"]);
  });

  it("does NOT append backend-artifact for atlas-next-ts-v2", () => {
    expect(buildPostDeveloperChain("atlas-next-ts-v2")).toEqual(["build-gate"]);
  });

  it("does NOT append backend-artifact for an unknown template", () => {
    expect(buildPostDeveloperChain("unknown-template")).toEqual(["build-gate"]);
  });

  it("handles undefined template by returning the base chain", () => {
    expect(buildPostDeveloperChain(undefined)).toEqual(["build-gate"]);
  });
});
