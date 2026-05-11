import { describe, it, expect } from "vitest";
import { classifyEdit } from "../src/classify.js";

describe("classifyEdit", () => {
  it("no changes → cosmetic with empty drivers (degenerate)", () => {
    const r = classifyEdit([]);
    expect(r.class).toBe("cosmetic");
    expect(r.drivers).toEqual([]);
  });

  it("title-only change → cosmetic", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "X", newValue: "Y" }
    ], { kindOf: () => "page" });
    expect(r.class).toBe("cosmetic");
    expect(r.drivers).toHaveLength(1);
  });

  it("title + path change → structural (path drives)", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "X", newValue: "Y" },
      { kind: "modified", nodeId: "page:home", fieldPath: "path", oldValue: "/", newValue: "/welcome" }
    ], { kindOf: () => "page" });
    expect(r.class).toBe("structural");
    expect(r.drivers.find((d) => d.fieldPath === "path")).toBeDefined();
  });

  it("any AuthBoundary change → security-compliance-touching", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "ab:user", fieldPath: "permissions", oldValue: [], newValue: ["read"] }
    ], { kindOf: () => "authboundary" });
    expect(r.class).toBe("security-compliance-touching");
  });

  it("Model.rlsPolicies change → security-compliance-touching even with cosmetic siblings", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "model:user", fieldPath: "name", oldValue: "User", newValue: "AppUser" },
      { kind: "modified", nodeId: "model:user", fieldPath: "rlsPolicies.select", oldValue: "auth.uid()", newValue: "true" }
    ], { kindOf: () => "model" });
    expect(r.class).toBe("security-compliance-touching");
  });

  it("reason string names the highest-tier driver", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "ab:admin", fieldPath: "roles", oldValue: ["admin"], newValue: ["admin", "auditor"] }
    ], { kindOf: () => "authboundary" });
    expect(r.reason).toContain("authboundary");
    expect(r.reason).toContain("ab:admin");
  });
});
