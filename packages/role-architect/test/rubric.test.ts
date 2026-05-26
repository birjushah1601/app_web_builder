import { describe, it, expect, vi } from "vitest";
import { architectRubric } from "../src/rubric.js";

describe("architectRubric.structural", () => {
  it("passes a complete new-app artifact", () => {
    const result = architectRubric.structural({
      scope: "new-app",
      runnablePlan: { tasks: [{ id: "t1", text: "do x" }] },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing" }] }
    } as any, /* inv */ {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails empty plan for new-app", () => {
    const result = architectRubric.structural({
      scope: "new-app",
      runnablePlan: { tasks: [] },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    } as any, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "plan_has_tasks")).toBe(true);
    }
  });

  it("fails missing scope", () => {
    const result = architectRubric.structural({
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    } as any, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "scope_present")).toBe(true);
    }
  });

  it("fails invalid graph_slice_hash", () => {
    const result = architectRubric.structural({
      scope: "bug-fix",
      graphSlice: { bytes: "{}", hash: "not-a-hash" }
    } as any, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "graph_slice_hash")).toBe(true);
    }
  });

  it("fails canvas_modes when frontend-app has no modes", () => {
    const result = architectRubric.structural({
      scope: "new-app",
      runnablePlan: { tasks: [{ id: "t1" }] },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      canvasManifest: { artifactKind: "frontend-app", modes: [] }
    } as any, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "canvas_modes")).toBe(true);
    }
  });
});

describe("architectRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true, score: 8.5,
          dimensions: [
            { name: "intent_coverage", score: 9, rationale: "addresses billing" },
            { name: "specificity", score: 8, rationale: "concrete" },
            { name: "feasibility", score: 9, rationale: "ok" },
            { name: "scope_match", score: 8, rationale: "right scope" }
          ],
          fixableBy: "retry",
          feedback: "no changes needed"
        }
      })
    };
    const result = await architectRubric.judge(
      { scope: "new-app" } as any,
      { userTurn: "Build it" } as any,
      stubLlm as any
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(8.5);
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: 99 /* invalid */, dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      architectRubric.judge({ scope: "new-app" } as any, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
