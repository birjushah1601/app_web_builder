import { describe, it, expect } from "vitest";
import { isProtectedTarget, protectedKindOf } from "../src/protected.js";

describe("isProtectedTarget", () => {
  it("flags AuthBoundary as protected", () => {
    const node = { id: "ab1", kind: "authboundary" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("authboundary");
  });

  it("flags Model with piiClassification!=none as protected", () => {
    const node = { id: "m1", kind: "model", piiClassification: "pii" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("pii-model");
  });

  it("does NOT flag Model with piiClassification=none", () => {
    const node = { id: "m2", kind: "model", piiClassification: "none" } as never;
    expect(isProtectedTarget(node)).toBe(false);
  });

  it("flags ComplianceClass != baseline as protected", () => {
    const node = { id: "c1", kind: "compliance", name: "hipaa" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("compliance");
  });

  it("does NOT flag ComplianceClass named 'baseline'", () => {
    const node = { id: "c2", kind: "compliance", name: "baseline" } as never;
    expect(isProtectedTarget(node)).toBe(false);
  });

  it("returns false for non-protected kinds", () => {
    const node = { id: "p1", kind: "page" } as never;
    expect(isProtectedTarget(node)).toBe(false);
    expect(protectedKindOf(node)).toBeNull();
  });
});
