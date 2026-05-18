import { describe, expect, it } from "vitest";
import { DependencySchema } from "../../src/nodes/dependency.js";

const valid = {
  kind: "dependency" as const,
  id: "dependency:react",
  name: "react",
  version: "18.3.1",
  purpose: "UI runtime",
  license: "MIT",
  cveScanStatus: { scannedAt: "2026-04-18T00:00:00.000Z", severity: "none", findings: [] }
};

describe("DependencySchema", () => {
  it("accepts valid dependency", () => {
    expect(() => DependencySchema.parse(valid)).not.toThrow();
  });
  it("rejects unpinned version (must be exact, no semver ranges)", () => {
    expect(() => DependencySchema.parse({ ...valid, version: "^18.3.1" })).toThrow();
    expect(() => DependencySchema.parse({ ...valid, version: "~18.3.1" })).toThrow();
    expect(() => DependencySchema.parse({ ...valid, version: ">=18" })).toThrow();
  });
  it("accepts a critical CVE finding", () => {
    expect(() =>
      DependencySchema.parse({
        ...valid,
        cveScanStatus: {
          scannedAt: "2026-04-18T00:00:00.000Z",
          severity: "critical",
          findings: [{ id: "CVE-2026-9999", cvss: 9.8 }]
        }
      })
    ).not.toThrow();
  });
});
