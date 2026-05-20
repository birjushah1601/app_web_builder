import { describe, expect, it } from "vitest";
import { i06NoCriticalCves } from "../../src/invariants/i06-no-critical-cves.js";
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

describe("i06: no dependency may have a critical CVE", () => {
  it("ok when no dependencies", () => {
    expect(i06NoCriticalCves(baseGraph())).toEqual([]);
  });

  it("ok when dependency has severity=none", () => {
    const g = baseGraph({
      nodes: {
        "dependency:react": {
          kind: "dependency",
          id: "dependency:react",
          name: "react",
          version: "18.3.1",
          license: "MIT",
          cveScanStatus: { scannedAt: "2026-04-18T00:00:00.000Z", severity: "none", findings: [] }
        }
      } as never
    });
    expect(i06NoCriticalCves(g)).toEqual([]);
  });

  it("flags dependency with critical severity", () => {
    const g = baseGraph({
      nodes: {
        "dependency:react": {
          kind: "dependency",
          id: "dependency:react",
          name: "react",
          version: "18.3.1",
          license: "MIT",
          cveScanStatus: {
            scannedAt: "2026-04-18T00:00:00.000Z",
            severity: "critical",
            findings: [{ id: "CVE-2026-9999", cvss: 9.8 }]
          }
        }
      } as never
    });
    const issues = i06NoCriticalCves(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I06_DEPENDENCY_HAS_CRITICAL_CVE");
    expect(issues[0]?.nodeId).toBe("dependency:react");
  });
});
