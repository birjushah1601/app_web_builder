import { describe, it, expect } from "vitest";
import { withDefaults } from "../src/anthropic-pass.js";

describe("withDefaults — F2 fix for tools-stripping proxies", () => {
  it("passes through valid input unchanged (key fields preserved)", () => {
    const input = {
      diff: "diff --git a/x b/x",
      summary: "x",
      testsAdded: ["t.ts"],
      filesModified: ["x.ts"]
    };
    const out = withDefaults(input) as Record<string, unknown>;
    expect(out.diff).toBe("diff --git a/x b/x");
    expect(out.summary).toBe("x");
    expect(out.testsAdded).toEqual(["t.ts"]);
    expect(out.filesModified).toEqual(["x.ts"]);
  });

  it("defaults missing testsAdded to []", () => {
    const input = { diff: "diff --git a/x b/x", summary: "x", filesModified: ["x.ts"] };
    const out = withDefaults(input) as Record<string, unknown>;
    expect(out.testsAdded).toEqual([]);
  });

  it("recovers filesModified from a real git-format diff when missing", () => {
    const diff =
      "diff --git a/src/login.tsx b/src/login.tsx\n--- a/src/login.tsx\n+++ b/src/login.tsx\n@@ -0,0 +1,3 @@\n+x\n" +
      "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -0,0 +1,1 @@\n+y\n";
    const out = withDefaults({ diff, summary: "s" }) as Record<string, unknown>;
    expect(out.filesModified).toEqual(["src/login.tsx", "src/auth.ts"]);
  });

  it("recovers filesModified from `+++ b/path` headers when `diff --git` headers are absent", () => {
    const diff = "+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n+a\n";
    const out = withDefaults({ diff, summary: "s" }) as Record<string, unknown>;
    expect(out.filesModified).toEqual(["src/foo.ts"]);
  });

  it("falls back to ['unspecified'] when neither filesModified nor diff yields any path", () => {
    const out = withDefaults({ diff: "some prose, not a real diff", summary: "s" }) as Record<string, unknown>;
    expect(out.filesModified).toEqual(["unspecified"]);
  });

  it("dedupes file paths when both diff --git and +++ b/ point at the same file", () => {
    const diff =
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+a\n";
    const out = withDefaults({ diff, summary: "s" }) as Record<string, unknown>;
    expect(out.filesModified).toEqual(["x.ts"]);
  });

  it("does NOT overwrite filesModified when the model supplied one", () => {
    const diff =
      "diff --git a/auto-detected.ts b/auto-detected.ts\n--- a/auto-detected.ts\n+++ b/auto-detected.ts\n@@\n";
    const out = withDefaults({ diff, summary: "s", filesModified: ["model-said-this.ts"] }) as Record<string, unknown>;
    expect(out.filesModified).toEqual(["model-said-this.ts"]);
  });

  it("returns input unchanged when input is not an object (string, null, undefined)", () => {
    expect(withDefaults("not an object")).toBe("not an object");
    expect(withDefaults(null)).toBe(null);
    expect(withDefaults(undefined)).toBe(undefined);
  });
});
