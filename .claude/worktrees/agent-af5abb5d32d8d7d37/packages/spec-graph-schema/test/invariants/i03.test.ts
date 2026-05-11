import { describe, expect, it } from "vitest";
import { i03PageAuthRequiredNeedsBoundary } from "../../src/invariants/i03-page-auth-required-needs-boundary.js";
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

describe("i03: Page with authRequired must have requires-edge to an AuthBoundary", () => {
  it("ok when no authRequired pages", () => {
    const g = baseGraph({
      nodes: {
        "page:home": {
          kind: "page",
          id: "page:home",
          path: "/",
          title: "Home",
          renderMode: "ssr",
          authRequired: false,
          routeRef: "GET /"
        }
      } as never
    });
    expect(i03PageAuthRequiredNeedsBoundary(g)).toEqual([]);
  });
  it("ok when authRequired page has requires-edge to AuthBoundary", () => {
    const g = baseGraph({
      nodes: {
        "page:admin": {
          kind: "page",
          id: "page:admin",
          path: "/admin",
          title: "Admin",
          renderMode: "ssr",
          authRequired: true,
          routeRef: "GET /admin"
        },
        "authboundary:admin": {
          kind: "authboundary",
          id: "authboundary:admin",
          name: "AdminOnly",
          type: "role",
          roles: ["admin"],
          permissions: [],
          bypassConditions: []
        }
      } as never,
      edges: [{ type: "requires", from: "page:admin", to: "authboundary:admin" }] as never
    });
    expect(i03PageAuthRequiredNeedsBoundary(g)).toEqual([]);
  });
  it("flags authRequired page missing AuthBoundary edge", () => {
    const g = baseGraph({
      nodes: {
        "page:admin": {
          kind: "page",
          id: "page:admin",
          path: "/admin",
          title: "Admin",
          renderMode: "ssr",
          authRequired: true,
          routeRef: "GET /admin"
        }
      } as never
    });
    const issues = i03PageAuthRequiredNeedsBoundary(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I03_AUTH_PAGE_MISSING_BOUNDARY");
    expect(issues[0]?.nodeId).toBe("page:admin");
  });
});
