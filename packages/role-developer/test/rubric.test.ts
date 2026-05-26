import { describe, it, expect, vi } from "vitest";
import { developerRubric } from "../src/rubric.js";

const VALID_HASH = "sha256:" + "0".repeat(64);

const GOOD_DIFF = `diff --git a/src/app/page.tsx b/src/app/page.tsx
index abc..def 100644
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1,3 +1,5 @@
+import React from "react";
 export default function Page() {
-  return <div>Hello</div>;
+  return <div>Hello World</div>;
 }
`;

const GOOD_OUTPUT = {
  diff: GOOD_DIFF,
  summary: "Add greeting to the landing page component",
  testsAdded: [],
  filesModified: ["src/app/page.tsx"]
};

describe("developerRubric.structural", () => {
  it("passes a valid new-app diff", () => {
    const result = developerRubric.structural(GOOD_OUTPUT, {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails when diff is empty", () => {
    const result = developerRubric.structural({ ...GOOD_OUTPUT, diff: "" }, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "diff_present")).toBe(true);
    }
  });

  it("fails when diff has no diff --git headers", () => {
    const result = developerRubric.structural(
      { ...GOOD_OUTPUT, diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n+const x = 1;\n" },
      {} as any
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "diff_format")).toBe(true);
    }
  });

  it("fails when summary is too short", () => {
    const result = developerRubric.structural({ ...GOOD_OUTPUT, summary: "short" }, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "summary_meaningful")).toBe(true);
    }
  });

  it("fails new_app_page when scope=new-app and diff does not touch page file", () => {
    const diffNoPage = GOOD_DIFF.replace(/page\.tsx/g, "components/Button.tsx");
    const inv = { priorArtifact: { scope: "new-app" } } as any;
    const result = developerRubric.structural({ ...GOOD_OUTPUT, diff: diffNoPage }, inv);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "new_app_page")).toBe(true);
    }
  });

  it("does not require page file for non-new-app scope", () => {
    const diffNoPage = GOOD_DIFF.replace(/page\.tsx/g, "components/Button.tsx");
    const inv = { priorArtifact: { scope: "bug-fix" } } as any;
    const result = developerRubric.structural(
      { ...GOOD_OUTPUT, diff: diffNoPage, summary: "Fix button accessibility in components" },
      inv
    );
    expect(result.passed).toBe(true);
  });
});

describe("developerRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true,
          score: 7.5,
          dimensions: [
            { name: "plan_adherence", score: 8, rationale: "follows the plan" },
            { name: "completeness", score: 7, rationale: "all files present" },
            { name: "syntactic_plausibility", score: 8, rationale: "valid diff" },
            { name: "no_truncation", score: 7, rationale: "diff complete" }
          ],
          fixableBy: "retry",
          feedback: "Looks good overall"
        }
      })
    };
    const result = await developerRubric.judge(
      GOOD_OUTPUT,
      { userTurn: "Build a landing page" } as any,
      stubLlm as any
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(7.5);
    expect(stubLlm.completeWithToolUse).toHaveBeenCalledOnce();
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: 999 /* invalid */, dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      developerRubric.judge(GOOD_OUTPUT, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
