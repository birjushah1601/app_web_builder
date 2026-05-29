import { describe, it, expect } from "vitest";
import { buildTestsArtifact } from "../src/build-artifact.js";

describe("buildTestsArtifact", () => {
  it("builds a vitest TestsArtifact from parsed spec results", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [
        { file: "__tests__/Home.test.tsx", passed: 5, failed: 0, skipped: 0, durationMs: 120 },
        { file: "__tests__/About.test.tsx", passed: 3, failed: 1, skipped: 0, durationMs: 80, lastError: "boom" }
      ],
      targetsBySpec: {
        "__tests__/Home.test.tsx": ["frontend"],
        "__tests__/About.test.tsx": ["frontend"]
      }
    });
    expect(a.kind).toBe("tests");
    expect(a.framework).toBe("vitest");
    expect(a.specs).toHaveLength(2);
    expect(a.specs[0]?.targets).toEqual(["frontend"]);
    expect(a.specs[1]?.lastError).toBe("boom");
  });

  it("threads optional coverage through verbatim", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [],
      targetsBySpec: {},
      coverage: { lines: 92.3, branches: 81.0 }
    });
    expect(a.coverage).toEqual({ lines: 92.3, branches: 81.0 });
  });

  it("defaults targets to [] when no mapping is provided", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [{ file: "x.test.tsx", passed: 1, failed: 0, skipped: 0, durationMs: 10 }],
      targetsBySpec: {}
    });
    expect(a.specs[0]?.targets).toEqual([]);
  });
});
