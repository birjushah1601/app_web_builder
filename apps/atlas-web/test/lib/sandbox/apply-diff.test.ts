import { describe, it, expect } from "vitest";
import { parseDiff } from "@/lib/sandbox/apply-diff";

describe("parseDiff — create operation", () => {
  it("extracts a new file from a create-only diff", () => {
    const diff =
      "diff --git a/src/login.tsx b/src/login.tsx\n" +
      "new file mode 100644\n" +
      "index 0000000..abc1234\n" +
      "--- /dev/null\n" +
      "+++ b/src/login.tsx\n" +
      "@@ -0,0 +1,3 @@\n" +
      "+export function Login() {\n" +
      "+  return <form />;\n" +
      "+}\n";
    const { ops, error } = parseDiff(diff);
    expect(error).toBeUndefined();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("create");
    expect(ops[0]!.path).toBe("src/login.tsx");
    expect(ops[0]!.newContent).toBe("export function Login() {\n  return <form />;\n}\n");
  });
});

describe("parseDiff — modify operation", () => {
  it("extracts a modify op with hunk metadata (newContent reconstructed in applyFileOp, not parseDiff)", () => {
    const diff =
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,3 +1,3 @@\n" +
      " line1\n" +
      "-line2\n" +
      "+line2-modified\n" +
      " line3\n";
    const { ops } = parseDiff(diff);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("modify");
    expect(ops[0]!.path).toBe("src/foo.ts");
    // newContent is undefined for modify ops at parse time — applyFileOp
    // reconstructs it by reading the existing file + applying hunks
    expect(ops[0]!.newContent).toBeUndefined();
  });
});

describe("parseDiff — delete operation", () => {
  it("extracts a delete op when file goes to /dev/null", () => {
    const diff =
      "diff --git a/src/old.ts b/src/old.ts\n" +
      "deleted file mode 100644\n" +
      "--- a/src/old.ts\n" +
      "+++ /dev/null\n" +
      "@@ -1,2 +0,0 @@\n" +
      "-line1\n" +
      "-line2\n";
    const { ops } = parseDiff(diff);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("delete");
    expect(ops[0]!.path).toBe("src/old.ts");
  });
});

describe("parseDiff — multi-file diff", () => {
  it("yields multiple ops in source order", () => {
    const diff =
      "diff --git a/a.ts b/a.ts\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1,1 @@\n+a\n" +
      "diff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+b\n" +
      "diff --git a/c.ts b/c.ts\n--- /dev/null\n+++ b/c.ts\n@@ -0,0 +1,1 @@\n+c\n";
    const { ops } = parseDiff(diff);
    expect(ops.map((o) => o.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(ops.every((o) => o.kind === "create")).toBe(true);
  });
});

describe("parseDiff — empty/edge", () => {
  it("returns ops:[] for empty string (not an error)", () => {
    expect(parseDiff("")).toEqual({ ops: [] });
  });

  it("returns ops:[] for whitespace-only", () => {
    expect(parseDiff("   \n  \t  \n")).toEqual({ ops: [] });
  });

  it("returns ops:[] for prose that contains no diff markers", () => {
    expect(parseDiff("hello world, this is not a diff").ops).toEqual([]);
  });

  it("never throws on garbage input — returns structured result", () => {
    // parse-diff is permissive; garbage either yields ops:[] or partial
    // ops, but it should never throw. This is the contract.
    expect(() => parseDiff("\\x00\\x01\\x02 not a diff")).not.toThrow();
    expect(() => parseDiff("--- a/x\n+++ b/x\n@@ malformed @@\n")).not.toThrow();
  });
});
