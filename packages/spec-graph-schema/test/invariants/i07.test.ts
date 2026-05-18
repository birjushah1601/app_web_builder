import { describe, expect, it } from "vitest";
import { i07RendersTargetExists } from "../../src/invariants/i07-renders-target-exists.js";
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

describe("i07: renders edges must target an existing Component", () => {
  it("ok when renders edge points at existing component", () => {
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
        },
        "component:Button": {
          kind: "component",
          id: "component:Button",
          name: "Button",
          styleApproach: "tailwind",
          isServerComponent: false
        }
      } as never,
      edges: [{ type: "renders", from: "page:home", to: "component:Button" }] as never
    });
    expect(i07RendersTargetExists(g)).toEqual([]);
  });

  it("flags dangling renders target", () => {
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
      } as never,
      edges: [{ type: "renders", from: "page:home", to: "component:Missing" }] as never
    });
    const issues = i07RendersTargetExists(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I07_RENDERS_DANGLING_REF");
    expect(issues[0]?.edgeIndex).toBe(0);
  });

  it("flags renders pointing at non-component kind", () => {
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
        },
        "page:other": {
          kind: "page",
          id: "page:other",
          path: "/other",
          title: "Other",
          renderMode: "ssr",
          authRequired: false,
          routeRef: "GET /other"
        }
      } as never,
      edges: [{ type: "renders", from: "page:home", to: "page:other" }] as never
    });
    const issues = i07RendersTargetExists(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I07_RENDERS_WRONG_KIND");
    expect(issues[0]?.edgeIndex).toBe(0);
  });
});
