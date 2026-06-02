import { describe, it, expect, vi } from "vitest";
import { testsRubric } from "../src/rubric.js";
import type { TestsArtifact } from "@atlas/workflow-engine";

const GOOD_ARTIFACT: TestsArtifact = {
  schemaVersion: "1",
  kind: "tests",
  framework: "vitest",
  specs: [
    {
      file: "src/__tests__/page.test.tsx",
      targets: ["frontend"],
      passed: 3,
      failed: 0,
      skipped: 0,
      durationMs: 120
    }
  ]
};

describe("testsRubric.structural", () => {
  it("passes a valid TestsArtifact", () => {
    const result = testsRubric.structural(GOOD_ARTIFACT, {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails schema when artifact is malformed", () => {
    const bad = { schemaVersion: "1", kind: "tests" } as unknown as TestsArtifact;
    const result = testsRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "schema")).toBe(true);
    }
  });

  it("fails specs_present when specs array is empty", () => {
    const bad: TestsArtifact = { ...GOOD_ARTIFACT, specs: [] };
    const result = testsRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "specs_present")).toBe(true);
    }
  });
});

describe("testsRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true,
          score: 8,
          dimensions: [{ name: "coverage", score: 8, rationale: "ok" }],
          fixableBy: "retry",
          feedback: "ok"
        }
      })
    };
    const result = await testsRubric.judge(GOOD_ARTIFACT, { userTurn: "write tests" } as any, stubLlm as any);
    expect(result.passed).toBe(true);
    expect(stubLlm.completeWithToolUse).toHaveBeenCalledOnce();
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: 12, dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      testsRubric.judge(GOOD_ARTIFACT, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
