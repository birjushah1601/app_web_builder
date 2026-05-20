import { describe, expect, it } from "vitest";
import { AuthBoundarySchema } from "../../src/nodes/auth-boundary.js";

const valid = {
  kind: "authboundary" as const,
  id: "authboundary:admin",
  name: "AdminOnly",
  type: "role",
  roles: ["admin"],
  permissions: [],
  bypassConditions: []
};

describe("AuthBoundarySchema", () => {
  it("accepts valid boundary", () => {
    expect(() => AuthBoundarySchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown type", () => {
    expect(() => AuthBoundarySchema.parse({ ...valid, type: "vibes" })).toThrow();
  });
  it("type=public allows empty roles", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "public", roles: [] })
    ).not.toThrow();
  });
  it("type=role requires at least one role", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "role", roles: [] })
    ).toThrow();
  });
  it("type=permission requires at least one permission", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "permission", roles: [], permissions: [] })
    ).toThrow();
  });
});
