import { describe, it, expect } from "vitest";
import { parseDiff, sanitizePath } from "@/lib/sandbox/apply-diff";

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

describe("sanitizePath — security boundary", () => {
  const ROOT = "/code";

  it("returns the joined path for a valid relative input", () => {
    expect(sanitizePath("src/login.tsx", ROOT)).toBe("/code/src/login.tsx");
  });

  it("strips a leading a/ or b/ git prefix", () => {
    expect(sanitizePath("a/src/foo.ts", ROOT)).toBe("/code/src/foo.ts");
    expect(sanitizePath("b/src/foo.ts", ROOT)).toBe("/code/src/foo.ts");
  });

  it("rejects paths starting with / (absolute)", () => {
    expect(sanitizePath("/etc/passwd", ROOT)).toBeNull();
  });

  it("rejects paths containing .. that escape the root", () => {
    expect(sanitizePath("../etc/passwd", ROOT)).toBeNull();
    expect(sanitizePath("src/../../etc/passwd", ROOT)).toBeNull();
  });

  it("rejects paths with embedded null bytes", () => {
    expect(sanitizePath("src/foo\u0000.ts", ROOT)).toBeNull();
  });

  it("normalizes redundant ./ segments", () => {
    expect(sanitizePath("src/./foo.ts", ROOT)).toBe("/code/src/foo.ts");
    expect(sanitizePath("./src/foo.ts", ROOT)).toBe("/code/src/foo.ts");
  });

  it("allows internal .. as long as the result stays under root", () => {
    expect(sanitizePath("src/utils/../foo.ts", ROOT)).toBe("/code/src/foo.ts");
  });
});

import { applyFileOp } from "@/lib/sandbox/apply-diff";
import type { SandboxFileSystemLike } from "@/lib/sandbox/apply-diff-types";

/** In-memory fs used by every applyFileOp / applyDiff test. */
function memoryFs(initial: Record<string, string> = {}): SandboxFileSystemLike & { _store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    _store: store,
    async read(path) {
      const v = store.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    async write(path, content) { store.set(path, content); },
    async exists(path) { return store.has(path); },
    async remove(path) { store.delete(path); }
  };
}

describe("applyFileOp — create", () => {
  it("writes new file content and reports written status", async () => {
    const fs = memoryFs();
    const result = await applyFileOp(fs, {
      kind: "create",
      path: "src/login.tsx",
      newContent: "export function Login() {}\n"
    }, "/code");
    expect(result.status).toBe("written");
    expect(result.path).toBe("src/login.tsx");
    expect(result.bytesWritten).toBe(27);
    expect(fs._store.get("/code/src/login.tsx")).toBe("export function Login() {}\n");
  });

  it("rejects a create with no newContent (parse bug); status=failed", async () => {
    const fs = memoryFs();
    const result = await applyFileOp(fs, { kind: "create", path: "src/x.ts" }, "/code");
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no newContent/i);
  });

  it("rejects path-escape; never touches the fs", async () => {
    const fs = memoryFs();
    const result = await applyFileOp(fs, {
      kind: "create",
      path: "../etc/passwd",
      newContent: "evil"
    }, "/code");
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/path/i);
    expect(fs._store.size).toBe(0);
  });

  it("propagates fs.write errors as status=failed", async () => {
    const fs: SandboxFileSystemLike = {
      async read() { throw new Error("no"); },
      async write() { throw new Error("disk full"); },
      async exists() { return false; },
      async remove() {}
    };
    const result = await applyFileOp(fs, {
      kind: "create",
      path: "src/x.ts",
      newContent: "x"
    }, "/code");
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("disk full");
  });
});

describe("applyFileOp — delete", () => {
  it("removes existing file and reports written status", async () => {
    const fs = memoryFs({ "/code/src/old.ts": "x" });
    const result = await applyFileOp(fs, { kind: "delete", path: "src/old.ts" }, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.has("/code/src/old.ts")).toBe(false);
  });

  it("skips with reason when target is already absent (idempotent)", async () => {
    const fs = memoryFs();
    const result = await applyFileOp(fs, { kind: "delete", path: "src/gone.ts" }, "/code");
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/already absent/i);
  });

  it("propagates fs.remove errors as status=failed", async () => {
    const fs: SandboxFileSystemLike = {
      async read() { throw new Error("no"); },
      async write() {},
      async exists() { return true; },
      async remove() { throw new Error("permission denied"); }
    };
    const result = await applyFileOp(fs, { kind: "delete", path: "src/x.ts" }, "/code");
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("permission denied");
  });
});

describe("applyFileOp — modify", () => {
  it("reconstructs new content from existing + hunks and writes", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "line1\nline2\nline3\n" });
    // Need to drive applyFileOp via parseDiff so we get the parsed hunks
    // attached. parseDiff tags modify ops with their chunks via a private
    // _chunks field (added in this task).
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
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.get("/code/src/foo.ts")).toBe("line1\nline2-modified\nline3\n");
  });

  it("skips with hunk-mismatch reason when existing line doesn't match expected context", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "totally different\n" });
    const diff =
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,3 +1,3 @@\n" +
      " line1\n" +
      "-line2\n" +
      "+line2-mod\n" +
      " line3\n";
    const { ops } = parseDiff(diff);
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/hunk/i);
  });

  it("skips with file-not-found reason when modify targets a non-existent file", async () => {
    const fs = memoryFs(); // empty
    const diff =
      "diff --git a/src/missing.ts b/src/missing.ts\n" +
      "--- a/src/missing.ts\n" +
      "+++ b/src/missing.ts\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-old\n" +
      "+new\n";
    const { ops } = parseDiff(diff);
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/not found|ENOENT/i);
  });

  it("handles multi-hunk modify (two hunks in the same file)", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "a\nb\nc\nd\ne\nf\ng\nh\n" });
    const diff =
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,3 +1,3 @@\n" +
      "-a\n" +
      "+A\n" +
      " b\n" +
      " c\n" +
      "@@ -6,3 +6,3 @@\n" +
      " f\n" +
      "-g\n" +
      "+G\n" +
      " h\n";
    const { ops } = parseDiff(diff);
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.get("/code/src/foo.ts")).toBe("A\nb\nc\nd\ne\nf\nG\nh\n");
  });

  it("preserves the original's lack-of-trailing-newline (does NOT add one)", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "line1\nline2\nline3" }); // NO trailing \n
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
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("written");
    // Critical: result must NOT have a trailing newline
    expect(fs._store.get("/code/src/foo.ts")).toBe("line1\nline2-modified\nline3");
  });

  it("preserves trailing newline when original had one", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "line1\nline2\nline3\n" });
    const diff =
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,3 +1,3 @@\n" +
      " line1\n" +
      "-line2\n" +
      "+line2-mod\n" +
      " line3\n";
    const { ops } = parseDiff(diff);
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.get("/code/src/foo.ts")).toBe("line1\nline2-mod\nline3\n");
  });

  it("applies a pure-insertion hunk (oldLines: 0) at the correct position", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "line1\nline2\nline3\n" });
    // Diff inserts 2 new lines AFTER line 2 (between line 2 and line 3).
    // Hunk header @@ -1,3 +1,5 @@: 3 old lines (line1, line2, line3) become 5
    // new lines (line1, line2, inserted-A, inserted-B, line3) — context lines
    // sandwich the +adds, exercising the cursor-doesn't-advance-on-add path.
    const diff =
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,3 +1,5 @@\n" +
      " line1\n" +
      " line2\n" +
      "+inserted-A\n" +
      "+inserted-B\n" +
      " line3\n";
    const { ops } = parseDiff(diff);
    const result = await applyFileOp(fs, ops[0]!, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.get("/code/src/foo.ts")).toBe("line1\nline2\ninserted-A\ninserted-B\nline3\n");
  });
});
