import { describe, expect, it } from "vitest";
import { i09TestCoverageRequiredTargets } from "../../src/invariants/i09-test-coverage-required-targets.js";
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

describe("i09: Page/ClientState/Endpoint/Flow/AuthBoundary need Test coverage", () => {
  it("ok when no covered-kind nodes", () => {
    expect(i09TestCoverageRequiredTargets(baseGraph())).toEqual([]);
  });

  it("ok when protected kind has a covers edge pointing at it", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr" },
        "test:Home": {
          kind: "test",
          id: "test:Home",
          name: "Home",
          layer: "L1",
          source: "generated",
          filepath: "t.ts",
          coversRef: ["page:home"]
        }
      } as never,
      edges: [{ type: "covers", from: "test:Home", to: "page:home" }] as never
    });
    expect(i09TestCoverageRequiredTargets(g)).toEqual([]);
  });

  it("flags uncovered page", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr" }
      } as never
    });
    const issues = i09TestCoverageRequiredTargets(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I09_MISSING_TEST_COVERAGE");
    expect(issues[0]?.nodeId).toBe("page:home");
  });

  it("flags multiple uncovered protected kinds", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr" },
        "endpoint:x": { kind: "endpoint", id: "endpoint:x", name: "x", routeRef: "GET /x", method: "GET" },
        "clientstate:c": {
          kind: "clientstate",
          id: "clientstate:c",
          name: "c",
          stateKind: "reducer",
          persistence: "none",
          scope: "page",
          piiClassification: "none"
        }
      } as never
    });
    const issues = i09TestCoverageRequiredTargets(g);
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.code === "I09_MISSING_TEST_COVERAGE")).toBe(true);
    const ids = issues.map((i) => i.nodeId).sort();
    expect(ids).toEqual(["clientstate:c", "endpoint:x", "page:home"]);
  });
});
