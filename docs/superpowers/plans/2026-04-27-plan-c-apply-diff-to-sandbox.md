# Plan C — Apply Developer Diff to Live Preview Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the developer's unified-diff output (already produced by Plan B and rendered in ChatPanel as text) into the running E2B sandbox so the preview iframe auto-refreshes via Next.js HMR, closing the user-visible loop "I described an app → I see it running."

**Architecture:** New `apps/atlas-web/lib/sandbox/apply-diff.ts` module parses the diff (via the `parse-diff` npm library), reconstructs each file's new content, and writes via a `SandboxFileSystemLike` adapter. `@atlas/ritual-engine` gains an optional `SandboxApplier` injection so the engine package stays free of E2B concerns; `apps/atlas-web/lib/engine/factory.ts` wires the real applier. Failure is structured (never thrown): every parse error, missing-hunk-context, path-escape, or write failure becomes a `FileApplyResult` and the ritual still returns 200. ChatPanel's existing `DeveloperOutputCard` adds a status line below the diff (green / amber / red) showing what was written.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · pnpm workspaces · `parse-diff@0.12.0` (new dep, ~5 KB, MIT, ~6M weekly DLs) · existing `@atlas/sandbox-e2b` for the sandbox SDK · Vitest 2.x.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan B merged — see `docs/superpowers/plans/2026-04-27-plan-b-developer-chain.md`. Specifically: `RitualSnapshot.developerOutput.diff` is populated when chain runs successfully; `getRitualEngine()` factory is wired with `DeveloperRole`.
- E2B template `atlas-next-ts` built on the operator's E2B account (`packages/sandbox-e2b/templates/atlas-next-ts/` README) — Plan C writes into `/code/src/` of a sandbox booted from that template.
- `apps/atlas-web/.env.local` has working `ATLAS_LLM_BASE_URL` (or `ANTHROPIC_API_KEY`) and `E2B_API_KEY`. Verify by running `pnpm dev` and seeing the canvas iframe load the placeholder Next app.
- Local Postgres on port 5440 (`docker compose up -d postgres`) — only for the existing ritual-engine integration test that depends on `SpecEventRepo`.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  package.json                                            # MODIFIED: + parse-diff dep
  lib/
    sandbox/
      apply-diff.ts                                       # NEW: parseDiff, applyDiff, sanitization
      apply-diff-types.ts                                 # NEW: FileOp, FileApplyResult, ApplyDiffResult, SandboxFileSystemLike
      sandbox-fs-adapter.ts                               # NEW: thin E2B adapter conforming to SandboxFileSystemLike
    engine/
      factory.ts                                          # MODIFIED: wire SandboxApplier into RitualEngineOptions
    actions/
      startRitual.ts                                      # MODIFIED: surface sandboxApplyResult
  components/
    ChatPanel.tsx                                         # MODIFIED: render apply-status line
  test/
    lib/
      sandbox/
        apply-diff.test.ts                                # NEW: ~15 cases
        sandbox-fs-adapter.test.ts                        # NEW: ~3 cases
      engine/
        factory.test.ts                                   # MODIFIED: + 1 case (sandboxApplier wired)
    components/
      ChatPanel.test.tsx                                  # MODIFIED: + 3 cases
    actions/
      startRitual.test.ts                                 # MODIFIED: + 1 case (return shape)

packages/ritual-engine/
  src/
    engine.ts                                             # MODIFIED: SandboxApplier interface + sandboxApplyResult on snapshot
  test/
    engine-developer-chain.test.ts                        # MODIFIED: + 3 cases for applier integration
```

**Why this shape.** Types live in their own file (`apply-diff-types.ts`) so both `apply-diff.ts` and `sandbox-fs-adapter.ts` can import them without a circular reference. The adapter is its own file because its job (translating E2B SDK calls into the abstract `SandboxFileSystemLike` shape) is small and testable in isolation. Every other change is a localized edit to a file that already exists.

---

## Design Decisions

These resolve the 4 open questions documented in the spec (§Open questions).

1. **Apply via `parse-diff` library + per-file `sandbox.fs.write`** — not `git apply` inside the sandbox, not full-files schema change. No template rebuild, no schema change in `@atlas/role-developer`, smallest blast radius.
2. **Best-effort across files** — when one file's hunk fails to apply, the orchestrator continues with the rest. Per-file `FileApplyResult` records what happened; the user gets partial value.
3. **`applyDiff` never throws** — every failure (parse error, missing sandbox, path escape, hunk mismatch, write failure) is structured into the return value so the ritual + ChatPanel always render a clear answer.
4. **Rely on Next's watcher** — the `atlas-next-ts` template runs `pnpm dev` which inotify-watches `/code/src/`. After Atlas writes files, HMR picks up changes within 1–3s. No iframe-reload code in atlas-web.
5. **Optional injection on `RitualEngineOptions`** — when no `sandboxApplier` is supplied (existing tests, alternative deployments), `start()` skips the apply step. Backward compatible — no engine test changes required.
6. **Pure-text diffs only** — binary diffs (`Binary files differ` in `parse-diff` output) are recorded as `skipped: binary diffs not supported`. Atlas's developer prompts focus on text source; defensible MVP scope.

---

## Task List (16 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a commit. Conventional Commits prefixes.

---

### Task 1: Add `parse-diff` workspace dep + smoke import

**Files:**
- Modify: `apps/atlas-web/package.json`

- [ ] **Step 1: Add the dependency**

Edit `apps/atlas-web/package.json` `dependencies` block — insert in alphabetical position:

```json
    "parse-diff": "0.12.0",
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: `pnpm install` completes with `Already up to date` for everything else and exactly one new package added (`parse-diff`).

- [ ] **Step 3: Verify it imports cleanly**

```bash
cd apps/atlas-web && node -e 'import("parse-diff").then(m => console.log(typeof m.default, "OK"))'
```

Expected stdout: `function OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/package.json pnpm-lock.yaml
git commit -m "chore(atlas-web): add parse-diff@0.12.0 for plan C diff application"
```

---

### Task 2: Define core types in `apply-diff-types.ts`

**Files:**
- Create: `apps/atlas-web/lib/sandbox/apply-diff-types.ts`
- Create: `apps/atlas-web/test/lib/sandbox/apply-diff-types.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/lib/sandbox/apply-diff-types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type {
  FileOp,
  FileApplyResult,
  ApplyDiffResult,
  SandboxFileSystemLike
} from "@/lib/sandbox/apply-diff-types";

describe("apply-diff types", () => {
  it("FileOp.kind is the strict 3-value union", () => {
    expectTypeOf<FileOp["kind"]>().toEqualTypeOf<"create" | "modify" | "delete">();
  });

  it("FileApplyResult.status is the strict 3-value union", () => {
    expectTypeOf<FileApplyResult["status"]>().toEqualTypeOf<"written" | "skipped" | "failed">();
  });

  it("ApplyDiffResult counts every parsed file in exactly one bucket", () => {
    // Compile-time assertion — written + skipped + failed should always
    // sum to parsed; this is enforced by callers, but the types let us
    // require all four counters at construction time.
    const r: ApplyDiffResult = {
      ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: []
    };
    expectTypeOf(r).toMatchTypeOf<ApplyDiffResult>();
  });

  it("SandboxFileSystemLike has read/write/exists methods returning Promises", () => {
    expectTypeOf<SandboxFileSystemLike["read"]>().returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf<SandboxFileSystemLike["write"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<SandboxFileSystemLike["exists"]>().returns.toEqualTypeOf<Promise<boolean>>();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff-types.test.ts
```

Expected: fails with `Cannot find module '@/lib/sandbox/apply-diff-types'`.

- [ ] **Step 3: Write the types module**

`apps/atlas-web/lib/sandbox/apply-diff-types.ts`:

```typescript
/** A single file-level operation extracted from a unified diff. */
export interface FileOp {
  kind: "create" | "modify" | "delete";
  /** Sandbox-relative path, sanitized — no leading `/`, no `..`,
   *  always relative to the apply rootDir (default `/code`). */
  path: string;
  /** For "create" and "modify": the full new content of the file.
   *  For "delete": absent. */
  newContent?: string;
}

/** Outcome of applying one FileOp to the sandbox. */
export interface FileApplyResult {
  path: string;
  status: "written" | "skipped" | "failed";
  /** Human-readable reason for non-"written" statuses. */
  reason?: string;
  /** Set when status === "written"; bytes written via fs.write. */
  bytesWritten?: number;
}

/** Aggregate outcome of applying a full diff. Never thrown — callers
 *  always receive this structure even when nothing was applied. */
export interface ApplyDiffResult {
  /** True iff parsed > 0 AND failed === 0. False on parse error or any
   *  per-file failure. Skipped files do NOT flip ok to false. */
  ok: boolean;
  /** Number of file ops the diff parsed into. 0 means parse failed
   *  OR the diff was empty/whitespace-only. */
  parsed: number;
  written: number;
  failed: number;
  skipped: number;
  files: FileApplyResult[];
  /** Present iff parsed === 0 due to a parse error. */
  parseError?: string;
}

/** Minimal filesystem surface applyDiff needs. The concrete
 *  implementation in sandbox-fs-adapter.ts wraps E2B's SDK; tests use
 *  an in-memory Map<string, string>. */
export interface SandboxFileSystemLike {
  /** Reads a file's content as UTF-8 string. Throws if not found. */
  read(path: string): Promise<string>;
  /** Writes content (creates parent dirs as needed). Throws on I/O failure. */
  write(path: string, content: string): Promise<void>;
  /** Returns true iff the path exists (file or directory). Never throws. */
  exists(path: string): Promise<boolean>;
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff-types.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff-types.ts apps/atlas-web/test/lib/sandbox/apply-diff-types.test.ts
git commit -m "feat(atlas-web): apply-diff core types (FileOp, ApplyDiffResult, SandboxFileSystemLike)"
```

---

### Task 3: `parseDiff` — happy path coverage (create, modify, delete, multi-file)

**Files:**
- Create: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Create: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 4 tests fail with `Cannot find module '@/lib/sandbox/apply-diff'`.

- [ ] **Step 3: Write the implementation**

`apps/atlas-web/lib/sandbox/apply-diff.ts`:

```typescript
import parseDiffLib from "parse-diff";
import type { FileOp } from "./apply-diff-types";

/** Parses a unified diff into per-file operations. Wraps the parse-diff
 *  npm library with our internal FileOp shape (which sanitizes paths
 *  and normalizes the create/modify/delete kind classification). */
export function parseDiff(diff: string): { ops: FileOp[]; error?: string } {
  if (!diff || !diff.trim()) {
    return { ops: [] };
  }

  let parsed: ReturnType<typeof parseDiffLib>;
  try {
    parsed = parseDiffLib(diff);
  } catch (err) {
    return { ops: [], error: `parse-diff threw: ${(err as Error).message}` };
  }

  const ops: FileOp[] = [];
  for (const file of parsed) {
    const kind = classifyKind(file);
    const rawPath = pickPath(file, kind);
    if (!rawPath) continue; // skip files we can't identify (rare; malformed input)
    const path = stripGitPrefix(rawPath);
    if (kind === "create") {
      const newContent = collectAddedLines(file);
      ops.push({ kind, path, newContent });
    } else if (kind === "delete") {
      ops.push({ kind, path });
    } else {
      // modify: newContent is reconstructed in applyFileOp using the
      // existing file's content + the parsed hunks
      ops.push({ kind, path });
    }
  }

  return { ops };
}

function classifyKind(file: parseDiffLib.File): FileOp["kind"] {
  if (file.new) return "create";
  if (file.deleted) return "delete";
  // Fallback: if `from` is /dev/null it's create; if `to` is /dev/null it's delete
  if (file.from === "/dev/null") return "create";
  if (file.to === "/dev/null") return "delete";
  return "modify";
}

function pickPath(file: parseDiffLib.File, kind: FileOp["kind"]): string | undefined {
  // For create: only `to` is meaningful. For delete: only `from`. For modify:
  // either works (they're the same) — prefer `to` since that's the post-image.
  if (kind === "delete") return file.from;
  return file.to;
}

function stripGitPrefix(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

function collectAddedLines(file: parseDiffLib.File): string {
  const lines: string[] = [];
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add") lines.push(change.content.slice(1)); // strip leading "+"
    }
  }
  // Preserve a trailing newline if the diff's last hunk doesn't end with
  // the "no newline" sentinel (parse-diff doesn't expose this directly,
  // but trailing \n is the safe default for source files)
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): parseDiff — happy path (create/modify/delete/multi-file)"
```

---

### Task 4: `parseDiff` — error and edge cases (empty, malformed, garbage input)

**Files:**
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apply-diff.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests; expect pass without code changes**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 8 total tests pass (4 from Task 3 + 4 new). The implementation already handles these — empty/whitespace early-returns; prose yields no `parseDiff()` matches.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "test(atlas-web): parseDiff edge cases (empty, whitespace, prose, garbage)"
```

---

### Task 5: `sanitizePath` — block path-escape attacks

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apply-diff.test.ts`:

```typescript
import { sanitizePath } from "@/lib/sandbox/apply-diff";

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
```

- [ ] **Step 2: Run tests; expect 7 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 7 new tests fail with `sanitizePath is not a function`.

- [ ] **Step 3: Add `sanitizePath` to apply-diff.ts**

Append to `apply-diff.ts`:

```typescript
/** Sanitize a diff-supplied path against the apply rootDir.
 *  Returns the absolute (rooted) path on success, or null when the
 *  input is unsafe (absolute, escapes root, contains null bytes, etc.).
 *
 *  Posix-style paths only — sandbox files live in a Linux container.
 */
export function sanitizePath(rawPath: string, rootDir: string): string | null {
  if (!rawPath || rawPath.includes("\u0000")) return null;
  // Strip git's a/ or b/ prefix (parse-diff sometimes leaves it)
  let p = rawPath;
  if (p.startsWith("a/") || p.startsWith("b/")) p = p.slice(2);
  if (p.startsWith("/")) return null;
  // Posix-normalize: collapse ./ and resolve internal .. segments
  const segments: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return null; // escape attempt
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  return `${rootDir.replace(/\/$/, "")}/${segments.join("/")}`;
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 15 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): sanitizePath blocks path-escape (../, absolute, null byte) for diff apply"
```

---

### Task 6: `applyFileOp(create)` — write new file content

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apply-diff.test.ts`:

```typescript
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
    async exists(path) { return store.has(path); }
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
      async exists() { return false; }
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
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 4 new tests fail with `applyFileOp is not a function`.

- [ ] **Step 3: Add `applyFileOp` (create branch only)**

Append to `apply-diff.ts`:

```typescript
import type { FileOp, FileApplyResult, SandboxFileSystemLike } from "./apply-diff-types";

/** Apply a single FileOp to the sandbox filesystem. Never throws —
 *  every error becomes status="failed" with a human-readable reason. */
export async function applyFileOp(
  fs: SandboxFileSystemLike,
  op: FileOp,
  rootDir: string
): Promise<FileApplyResult> {
  const safePath = sanitizePath(op.path, rootDir);
  if (!safePath) {
    return { path: op.path, status: "failed", reason: `path escape blocked: ${op.path}` };
  }

  if (op.kind === "create") {
    if (op.newContent === undefined) {
      return { path: op.path, status: "failed", reason: "no newContent on create op" };
    }
    try {
      await fs.write(safePath, op.newContent);
      return { path: op.path, status: "written", bytesWritten: byteLen(op.newContent) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  // modify and delete branches added in subsequent tasks
  return { path: op.path, status: "skipped", reason: `kind not yet supported: ${op.kind}` };
}

function byteLen(s: string): number {
  // Use Buffer for accurate UTF-8 byte length; fallback to char count.
  return typeof Buffer !== "undefined" ? Buffer.byteLength(s, "utf8") : s.length;
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 19 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): applyFileOp create — write new file, surface failures structurally"
```

---

### Task 7: `applyFileOp(modify)` — read existing, reconstruct, write

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apply-diff.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 4 new fails — modify branch not implemented, plus parseDiff doesn't yet attach hunks.

- [ ] **Step 3: Update parseDiff to retain hunks for modify ops**

In `apply-diff.ts`, extend `FileOp` references — add internal hunks attachment. **Modify** `apply-diff-types.ts` first:

```typescript
// Add to apply-diff-types.ts at the top:
import type { Chunk } from "parse-diff";

export interface FileOp {
  kind: "create" | "modify" | "delete";
  path: string;
  newContent?: string;
  /** Internal — hunks needed for modify reconstruction. Populated by
   *  parseDiff for kind="modify"; ignored for create/delete. */
  _chunks?: Chunk[];
}
```

In `apply-diff.ts`, update the modify branch of `parseDiff`:

```typescript
    } else {
      // modify: keep the parsed chunks for applyFileOp to reconstruct against
      ops.push({ kind, path, _chunks: file.chunks });
    }
```

- [ ] **Step 4: Add modify branch to applyFileOp**

In `apply-diff.ts`, replace the `if (op.kind === "create")` block with:

```typescript
  if (op.kind === "create") {
    if (op.newContent === undefined) {
      return { path: op.path, status: "failed", reason: "no newContent on create op" };
    }
    try {
      await fs.write(safePath, op.newContent);
      return { path: op.path, status: "written", bytesWritten: byteLen(op.newContent) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  if (op.kind === "modify") {
    if (!op._chunks || op._chunks.length === 0) {
      return { path: op.path, status: "skipped", reason: "no hunks attached to modify op" };
    }
    let existing: string;
    try {
      existing = await fs.read(safePath);
    } catch (err) {
      return { path: op.path, status: "skipped", reason: `read failed: ${(err as Error).message}` };
    }
    const reconstructed = reconstructFromChunks(existing, op._chunks);
    if (!reconstructed.ok) {
      return { path: op.path, status: "skipped", reason: reconstructed.reason };
    }
    try {
      await fs.write(safePath, reconstructed.content);
      return { path: op.path, status: "written", bytesWritten: byteLen(reconstructed.content) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }
```

Append the helper at the end of `apply-diff.ts`:

```typescript
import type { Chunk } from "parse-diff";

/** Apply parsed hunks to existing file content. Each hunk specifies
 *  `oldStart` / `oldLines` / a sequence of `add | del | normal` changes.
 *  We walk the original file line-by-line, splice in the hunks at the
 *  declared offsets, and fail loudly if a hunk's "context" lines don't
 *  match what's actually at that offset (no fuzzy matching — this is
 *  the MVP; Plan E will need leniency for multi-turn edits). */
function reconstructFromChunks(
  original: string,
  chunks: Chunk[]
): { ok: true; content: string } | { ok: false; reason: string } {
  const lines = original.split("\n");
  // parse-diff gives offsets in 1-based line numbers. We work in a
  // mutable copy and edit per-hunk; sort hunks by oldStart descending
  // so earlier indices remain valid as we splice.
  const sortedChunks = [...chunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const chunk of sortedChunks) {
    const offset = chunk.oldStart - 1; // 0-based slice index
    const replaced: string[] = [];
    let cursor = 0; // walks the original "old" lines for this chunk
    for (const change of chunk.changes) {
      if (change.type === "normal") {
        const expected = change.content.slice(1); // strip leading " "
        const actual = lines[offset + cursor];
        if (actual !== expected) {
          return {
            ok: false,
            reason: `hunk mismatch at line ${offset + cursor + 1}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
          };
        }
        replaced.push(expected);
        cursor++;
      } else if (change.type === "del") {
        const expected = change.content.slice(1); // strip leading "-"
        const actual = lines[offset + cursor];
        if (actual !== expected) {
          return {
            ok: false,
            reason: `hunk mismatch at line ${offset + cursor + 1}: expected to delete ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
          };
        }
        cursor++;
        // Don't push — this line is removed in the new content
      } else {
        // type === "add"
        replaced.push(change.content.slice(1)); // strip leading "+"
        // Don't advance cursor — this is a brand-new line
      }
    }
    lines.splice(offset, cursor, ...replaced);
  }
  return { ok: true, content: lines.join("\n") };
}
```

- [ ] **Step 5: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 23 total tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/lib/sandbox/apply-diff-types.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): applyFileOp modify — reconstruct from hunks, surface mismatch + ENOENT"
```

---

### Task 8: `applyFileOp(delete)` — remove file from sandbox

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff-types.ts`
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Add `remove` to SandboxFileSystemLike + write failing tests**

Edit `apply-diff-types.ts` — add a new method to the interface:

```typescript
export interface SandboxFileSystemLike {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Removes a file. No-op if absent. Throws on I/O error other than ENOENT. */
  remove(path: string): Promise<void>;
}
```

Append the failing tests to `apply-diff.test.ts`:

```typescript
function memoryFsWithRemove(initial: Record<string, string> = {}) {
  const fs = memoryFs(initial);
  return {
    ...fs,
    async remove(path: string) { fs._store.delete(path); }
  };
}

describe("applyFileOp — delete", () => {
  it("removes existing file and reports written status", async () => {
    const fs = memoryFsWithRemove({ "/code/src/old.ts": "x" });
    const result = await applyFileOp(fs, { kind: "delete", path: "src/old.ts" }, "/code");
    expect(result.status).toBe("written");
    expect(fs._store.has("/code/src/old.ts")).toBe(false);
  });

  it("skips with reason when target is already absent (idempotent)", async () => {
    const fs = memoryFsWithRemove();
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
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 3 new tests fail. Existing 4 `memoryFs(...)` callers still pass because the interface change is additive.

> Note: existing `memoryFs` calls now don't satisfy the extended interface for fs.remove. TypeScript will compile (interfaces with extra members are duck-typed at the use-site in tests), but runtime tests that call applyFileOp with a delete op against `memoryFs(...)` would break. Step 3 also updates `memoryFs` to include a no-op `remove`.

- [ ] **Step 3: Update memoryFs + add delete branch to applyFileOp**

In `apply-diff.test.ts`, update `memoryFs` to include `remove`:

```typescript
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
```

Then drop `memoryFsWithRemove` and just use `memoryFs` in the delete tests.

In `apply-diff.ts`, append the delete branch inside `applyFileOp`:

```typescript
  if (op.kind === "delete") {
    const present = await fs.exists(safePath);
    if (!present) {
      return { path: op.path, status: "skipped", reason: "already absent" };
    }
    try {
      await fs.remove(safePath);
      return { path: op.path, status: "written" };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }
```

Remove the `// modify and delete branches added in subsequent tasks` fall-through.

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 26 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/lib/sandbox/apply-diff-types.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): applyFileOp delete — idempotent removal, fs.remove on the interface"
```

---

### Task 9: `applyDiff` orchestrator — best-effort across files

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Modify: `apps/atlas-web/test/lib/sandbox/apply-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apply-diff.test.ts`:

```typescript
import { applyDiff } from "@/lib/sandbox/apply-diff";

describe("applyDiff orchestrator", () => {
  it("returns ok=false with parseError for unparseable input (not throwing)", async () => {
    const fs = memoryFs();
    const r = await applyDiff(fs, "");
    expect(r.ok).toBe(true); // empty diff → no-op, ok per contract
    expect(r.parsed).toBe(0);
    expect(r.files).toEqual([]);
  });

  it("aggregates per-file results across mixed create/modify/delete", async () => {
    const fs = memoryFs({ "/code/src/foo.ts": "line1\nline2\n" });
    const diff =
      "diff --git a/src/login.tsx b/src/login.tsx\n" +
      "--- /dev/null\n+++ b/src/login.tsx\n@@ -0,0 +1,1 @@\n+export {}\n" +
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,2 +1,2 @@\n line1\n-line2\n+line2X\n";
    const r = await applyDiff(fs, diff);
    expect(r.parsed).toBe(2);
    expect(r.written).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => `${f.path}:${f.status}`)).toEqual([
      "src/login.tsx:written",
      "src/foo.ts:written"
    ]);
  });

  it("ok=false when any file fails (path escape)", async () => {
    const fs = memoryFs();
    const diff =
      "diff --git a/src/ok.ts b/src/ok.ts\n" +
      "--- /dev/null\n+++ b/src/ok.ts\n@@ -0,0 +1,1 @@\n+x\n" +
      "diff --git a/../etc/passwd b/../etc/passwd\n" +
      "--- /dev/null\n+++ b/../etc/passwd\n@@ -0,0 +1,1 @@\n+evil\n";
    const r = await applyDiff(fs, diff);
    expect(r.parsed).toBe(2);
    expect(r.written).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("ok stays true when files are skipped but none failed", async () => {
    const fs = memoryFs();
    const diff =
      "diff --git a/src/missing.ts b/src/missing.ts\n" +
      "--- a/src/missing.ts\n+++ b/src/missing.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    const r = await applyDiff(fs, diff);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("respects custom rootDir option", async () => {
    const fs = memoryFs();
    const diff = "diff --git a/x.ts b/x.ts\n--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1,1 @@\n+a\n";
    const r = await applyDiff(fs, diff, { rootDir: "/sandbox/code" });
    expect(r.written).toBe(1);
    expect(fs._store.has("/sandbox/code/x.ts")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect 5 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 5 new tests fail with `applyDiff is not a function`.

- [ ] **Step 3: Add `applyDiff` to apply-diff.ts**

Append to `apply-diff.ts`:

```typescript
import type { ApplyDiffResult } from "./apply-diff-types";

const DEFAULT_ROOT = "/code";

export async function applyDiff(
  fs: SandboxFileSystemLike,
  diff: string,
  opts: { rootDir?: string } = {}
): Promise<ApplyDiffResult> {
  const rootDir = opts.rootDir ?? DEFAULT_ROOT;
  const { ops, error } = parseDiff(diff);

  if (error) {
    return { ok: false, parsed: 0, written: 0, failed: 0, skipped: 0, files: [], parseError: error };
  }
  if (ops.length === 0) {
    // Empty / whitespace / no-op diff. ok per contract — caller writes
    // nothing but doesn't see this as a failure.
    return { ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: [] };
  }

  const files: FileApplyResult[] = [];
  for (const op of ops) {
    files.push(await applyFileOp(fs, op, rootDir));
  }

  const written = files.filter((f) => f.status === "written").length;
  const failed = files.filter((f) => f.status === "failed").length;
  const skipped = files.filter((f) => f.status === "skipped").length;

  return {
    ok: failed === 0,
    parsed: ops.length,
    written,
    failed,
    skipped,
    files
  };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/apply-diff.test.ts
```

Expected: 31 total tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/test/lib/sandbox/apply-diff.test.ts
git commit -m "feat(atlas-web): applyDiff orchestrator — best-effort per-file, structured ApplyDiffResult"
```

---

### Task 10: `sandbox-fs-adapter` — translate E2B SDK to `SandboxFileSystemLike`

**Files:**
- Create: `apps/atlas-web/lib/sandbox/sandbox-fs-adapter.ts`
- Create: `apps/atlas-web/test/lib/sandbox/sandbox-fs-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/sandbox/sandbox-fs-adapter.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createSandboxFsAdapter } from "@/lib/sandbox/sandbox-fs-adapter";

describe("createSandboxFsAdapter", () => {
  it("read calls the underlying SandboxSession.fs.read with the absolute path", async () => {
    const read = vi.fn(async () => "hello");
    const session = { fs: { read, write: vi.fn(), exists: vi.fn(), remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    const out = await adapter.read("/code/x.ts");
    expect(read).toHaveBeenCalledWith("/code/x.ts");
    expect(out).toBe("hello");
  });

  it("write calls fs.write with path + content", async () => {
    const write = vi.fn(async () => {});
    const session = { fs: { read: vi.fn(), write, exists: vi.fn(), remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    await adapter.write("/code/x.ts", "content");
    expect(write).toHaveBeenCalledWith("/code/x.ts", "content");
  });

  it("exists returns the underlying boolean (no translation)", async () => {
    const exists = vi.fn(async () => true);
    const session = { fs: { read: vi.fn(), write: vi.fn(), exists, remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    expect(await adapter.exists("/code/x.ts")).toBe(true);
  });

  it("remove calls fs.remove and resolves regardless of return value", async () => {
    const remove = vi.fn(async () => {});
    const session = { fs: { read: vi.fn(), write: vi.fn(), exists: vi.fn(), remove } };
    const adapter = createSandboxFsAdapter(session as never);
    await adapter.remove("/code/x.ts");
    expect(remove).toHaveBeenCalledWith("/code/x.ts");
  });
});
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/sandbox-fs-adapter.test.ts
```

Expected: 4 fails with `Cannot find module '@/lib/sandbox/sandbox-fs-adapter'`.

- [ ] **Step 3: Write the adapter**

`apps/atlas-web/lib/sandbox/sandbox-fs-adapter.ts`:

```typescript
import type { SandboxFileSystemLike } from "./apply-diff-types";

/** Minimal session shape the adapter needs. We don't pull the full E2B
 *  SandboxSession type because the methods we depend on are stable
 *  across E2B SDK versions and importing the type here would couple
 *  this file to the SDK's internal package layout. */
interface SandboxSessionLike {
  fs: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  };
}

/** Wrap a SandboxSession's fs methods in the SandboxFileSystemLike
 *  interface that applyDiff consumes. Pure pass-through today;
 *  exists as a seam so future cross-cutting concerns (auditing,
 *  per-write logging, retry) live here, not in apply-diff.ts. */
export function createSandboxFsAdapter(session: SandboxSessionLike): SandboxFileSystemLike {
  return {
    read: (path) => session.fs.read(path),
    write: (path, content) => session.fs.write(path, content),
    exists: (path) => session.fs.exists(path),
    remove: (path) => session.fs.remove(path)
  };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/sandbox/sandbox-fs-adapter.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/sandbox-fs-adapter.ts apps/atlas-web/test/lib/sandbox/sandbox-fs-adapter.test.ts
git commit -m "feat(atlas-web): sandbox-fs-adapter — SandboxFileSystemLike over E2B session.fs"
```

---

### Task 11: ritual-engine — `SandboxApplier` interface + snapshot field

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`

- [ ] **Step 1: Inspect current RitualEngineOptions + RitualSnapshot shapes**

```bash
grep -n "RitualEngineOptions\|RitualSnapshot\|RoleEventRecord\|DeveloperOutputRecord\|interface RitualRecord" packages/ritual-engine/src/engine.ts | head
```

Confirm: `RitualEngineOptions` has `conductor`, `eventSink`, `personaPreferences`. `RitualSnapshot` has `state`, `projectId`, `userId`, `artifact`, `roleEvents`, `developerOutput`.

- [ ] **Step 2: Add the SandboxApplier interface, the snapshot field, and the option**

In `packages/ritual-engine/src/engine.ts`, find the existing `DeveloperOutputRecord` export and add immediately after it:

```typescript
/** Aggregate result of writing a developer's diff into the project's
 *  sandbox. Mirrors apps/atlas-web/lib/sandbox/apply-diff-types.ts so
 *  that snapshot consumers (Server Action, ChatPanel) get the same
 *  shape on both sides without round-tripping through `unknown`. */
export interface SandboxApplyResult {
  ok: boolean;
  parsed: number;
  written: number;
  failed: number;
  skipped: number;
  files: Array<{
    path: string;
    status: "written" | "skipped" | "failed";
    reason?: string;
    bytesWritten?: number;
  }>;
  parseError?: string;
}

/** Optional injection on RitualEngineOptions. Implementations live
 *  outside the engine package (atlas-web wires the real adapter via
 *  E2B; engine tests can stub or omit). When omitted, start() skips
 *  the apply step entirely — backward-compatible with existing tests. */
export interface SandboxApplier {
  apply(projectId: string, diff: string): Promise<SandboxApplyResult>;
}
```

In the same file, find `RitualEngineOptions` and add an optional field:

```typescript
export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
  sandboxApplier?: SandboxApplier;
}
```

In the `RitualEngine` class, store it in the constructor:

```typescript
  private readonly applier?: SandboxApplier;

  constructor(opts: RitualEngineOptions) {
    this.conductor = opts.conductor;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
    this.applier = opts.sandboxApplier;
  }
```

Find `RitualRecord` and add:

```typescript
interface RitualRecord {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  roleEvents?: RoleEventRecord[];
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
}
```

Find `RitualSnapshot` and add:

```typescript
export interface RitualSnapshot {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  roleEvents: RoleEventRecord[];
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
}
```

Find `getRitual` and update its return:

```typescript
  getRitual(ritualId: string): RitualSnapshot | undefined {
    const r = this.rituals.get(ritualId);
    if (!r) return undefined;
    return {
      state: r.state,
      projectId: r.projectId,
      userId: r.userId,
      artifact: r.artifact,
      roleEvents: r.roleEvents ?? [],
      developerOutput: r.developerOutput,
      sandboxApplyResult: r.sandboxApplyResult
    };
  }
```

- [ ] **Step 3: Verify the package still compiles + all existing tests pass**

```bash
pnpm -F @atlas/ritual-engine build
pnpm -F @atlas/ritual-engine test
```

Expected: build succeeds; 49 tests still pass (sandboxApplier is optional, so all existing tests that don't supply it work unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/ritual-engine/src/engine.ts
git commit -m "feat(ritual-engine): add optional SandboxApplier + sandboxApplyResult on snapshot (plan C)"
```

---

### Task 12: ritual-engine — chain into applier after developer succeeds

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Modify: `packages/ritual-engine/test/engine-developer-chain.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ritual-engine/test/engine-developer-chain.test.ts`:

```typescript
import type { SandboxApplier, SandboxApplyResult } from "../src/engine.js";

const VALID_APPLY: SandboxApplyResult = {
  ok: true,
  parsed: 2,
  written: 2,
  failed: 0,
  skipped: 0,
  files: [
    { path: "src/login.tsx", status: "written", bytesWritten: 50 },
    { path: "src/auth.ts", status: "written", bytesWritten: 30 }
  ]
};

function applierThat(behaviour: () => Promise<SandboxApplyResult>): SandboxApplier {
  return { apply: vi.fn(async () => behaviour()) };
}

function makeEngineWithApplier(conductor: Conductor, applier: SandboxApplier) {
  return new RitualEngine({
    conductor,
    eventSink: new InMemoryEventSink(),
    personaPreferences: { async getPersona() { return "diego"; } },
    sandboxApplier: applier
  });
}

describe("RitualEngine — sandbox apply (plan C)", () => {
  it("calls applier.apply(projectId, diff) when developer produced a diff", async () => {
    const conductor = chainConductor({});
    const apply = vi.fn(async () => VALID_APPLY);
    const engine = makeEngineWithApplier(conductor, { apply });

    const ritualId = await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(PROJECT_ID, DEVELOPER_DIFF);
    const snapshot = engine.getRitual(ritualId);
    expect(snapshot?.sandboxApplyResult).toEqual(VALID_APPLY);
  });

  it("does NOT call applier when developer produced no diff (diff.kind=none)", async () => {
    const conductor = chainConductor({
      developerOutput: {
        events: [{ eventType: "developer.completed", payload: { summary: "no changes" } }],
        diff: { kind: "none" as const }
      }
    });
    const apply = vi.fn();
    const engine = makeEngineWithApplier(conductor, { apply: apply as never });

    await engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    expect(apply).not.toHaveBeenCalled();
  });

  it("ritual still completes when applier returns ok:false (no throw, snapshot captures the failure)", async () => {
    const failApply: SandboxApplyResult = {
      ok: false, parsed: 1, written: 0, failed: 0, skipped: 0,
      files: [], parseError: "sandbox unavailable: ECONNREFUSED"
    };
    const conductor = chainConductor({});
    const engine = makeEngineWithApplier(conductor, applierThat(async () => failApply));

    const ritualId = await engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = engine.getRitual(ritualId);
    expect(snapshot?.sandboxApplyResult).toEqual(failApply);
    expect(snapshot?.developerOutput?.diff).toBe(DEVELOPER_DIFF);
  });
});
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
pnpm -F @atlas/ritual-engine test test/engine-developer-chain.test.ts
```

Expected: 3 new fails because `start()` doesn't yet call the applier.

- [ ] **Step 3: Update `start()` in `engine.ts`**

In `packages/ritual-engine/src/engine.ts`, find the block inside `start()` that captures `developerOutput`. Append immediately after the existing `record.developerOutput = ...` line and before the surrounding `} catch (err) {`:

```typescript
        // Plan C: write the diff into the live preview sandbox if an
        // applier is configured. Failures inside apply are captured into
        // the snapshot — never re-thrown — so the architect plan and
        // developer diff still surface to the user.
        if (this.applier && devResult.output.diff.kind === "patch" && devResult.output.diff.body) {
          try {
            const applyResult = await this.applier.apply(input.projectId, devResult.output.diff.body);
            record.sandboxApplyResult = applyResult;
          } catch (err) {
            record.sandboxApplyResult = {
              ok: false, parsed: 0, written: 0, failed: 0, skipped: 0,
              files: [], parseError: `applier threw: ${err instanceof Error ? err.message : String(err)}`
            };
          }
        }
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pnpm -F @atlas/ritual-engine test
```

Expected: 52 total tests pass (49 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-developer-chain.test.ts
git commit -m "feat(ritual-engine): start() chains into SandboxApplier when developer produced a diff (plan C)"
```

---

### Task 13: atlas-web factory — wire the real `SandboxApplier`

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/test/lib/engine/factory.test.ts`

- [ ] **Step 1: Extend the RitualEngine mock at the top of `factory.test.ts` to capture constructor opts**

The existing mock declares only the shape needed by plan B's tests; we need it to also capture `sandboxApplier`. Replace the existing `vi.mock("@atlas/ritual-engine", ...)` block with:

```typescript
const ritualEngineCtor = vi.fn();

vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: class {
    conductor: { roles: Map<string, unknown> };
    sandboxApplier?: { apply: unknown };
    constructor(opts: {
      conductor: { roles: Map<string, unknown> };
      sandboxApplier?: { apply: unknown };
    }) {
      ritualEngineCtor(opts);
      this.conductor = opts.conductor;
      this.sandboxApplier = opts.sandboxApplier;
    }
  }
}));
```

Add `ritualEngineCtor.mockClear()` to the `beforeEach` of both `describe` blocks in `factory.test.ts` (provider-precedence + DeveloperRole-registration), right alongside the existing `architectCtor.mockClear()` calls.

- [ ] **Step 2: Append the failing test**

Append to the `getRitualEngine — DeveloperRole registration (plan B)` describe block in `factory.test.ts`:

```typescript
  it("wires a sandboxApplier into RitualEngineOptions when llm is configured (plan C)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = ritualEngineCtor.mock.calls.at(-1)?.[0] as {
      sandboxApplier?: { apply: unknown };
    };
    expect(opts.sandboxApplier).toBeDefined();
    expect(typeof opts.sandboxApplier?.apply).toBe("function");
  });
```

- [ ] **Step 3: Run tests; expect 1 fail**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory.test.ts
```

Expected: 1 new fail (`opts.sandboxApplier` is undefined). Existing 13 cases still pass.

- [ ] **Step 4: Wire the real applier in `factory.ts`**

In `apps/atlas-web/lib/engine/factory.ts`, add at the top of the dynamic-import block:

```typescript
  const { applyDiff } = await import("@/lib/sandbox/apply-diff");
  const { createSandboxFsAdapter } = await import("@/lib/sandbox/sandbox-fs-adapter");
  const { getSandboxFactory } = await import("@/lib/sandbox/factory");
```

Replace the `return new RitualEngine({...})` block with:

```typescript
  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(new SpecEventRepo(pool), projectId),
    personaPreferences: prefs,
    sandboxApplier: {
      apply: async (projectId, diff) => {
        try {
          const session = await getSandboxFactory().getOrProvision(projectId);
          const fs = createSandboxFsAdapter(session as never);
          return await applyDiff(fs, diff);
        } catch (err) {
          return {
            ok: false, parsed: 0, written: 0, failed: 0, skipped: 0,
            files: [],
            parseError: `sandbox unavailable: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      }
    }
  });
```

- [ ] **Step 5: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory.test.ts
```

Expected: 14 total tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/engine/factory.test.ts
git commit -m "feat(atlas-web): factory wires SandboxApplier — diff goes to sandbox after developer runs"
```

---

### Task 14: `startRitual` action — surface `sandboxApplyResult`

**Files:**
- Modify: `apps/atlas-web/lib/actions/startRitual.ts`
- Modify: `apps/atlas-web/test/actions/startRitual.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("startRitual action", ...)` block in `test/actions/startRitual.test.ts`:

```typescript
  it("returns sandboxApplyResult from the engine snapshot when present", async () => {
    const start = vi.fn(async () => "r-789");
    const sandboxApplyResult = {
      ok: true, parsed: 2, written: 2, failed: 0, skipped: 0,
      files: [
        { path: "src/login.tsx", status: "written", bytesWritten: 50 },
        { path: "src/auth.ts", status: "written", bytesWritten: 30 }
      ]
    };
    const getRitual = vi.fn(() => ({
      state: "agree",
      projectId: "p-1",
      userId: "u-1",
      artifact: { plan: "x" },
      roleEvents: [],
      developerOutput: { diff: "diff --git ...", summary: "did it" },
      sandboxApplyResult
    }));
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start, getRitual })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    const r = await startRitual({ projectId: "p-1", userTurn: "add login", editClass: "structural" });
    expect(r.sandboxApplyResult).toEqual(sandboxApplyResult);
  });
```

- [ ] **Step 2: Run tests; expect 1 fail**

```bash
cd apps/atlas-web && pnpm test test/actions/startRitual.test.ts
```

Expected: 1 new fail because `r.sandboxApplyResult` is undefined.

- [ ] **Step 3: Update startRitual.ts**

In `apps/atlas-web/lib/actions/startRitual.ts`, extend `StartRitualResult` and the return:

```typescript
export interface StartRitualResult {
  ritualId: string;
  artifact?: unknown;
  roleEvents: Array<{ eventType: string; payload: unknown }>;
  developerOutput?: { diff: string; summary?: string };
  /** Plan C: per-file outcome of writing the developer's diff into the
   *  project's E2B sandbox. Absent when no developer diff was produced
   *  or no SandboxApplier was wired. */
  sandboxApplyResult?: {
    ok: boolean;
    parsed: number;
    written: number;
    failed: number;
    skipped: number;
    files: Array<{
      path: string;
      status: "written" | "skipped" | "failed";
      reason?: string;
      bytesWritten?: number;
    }>;
    parseError?: string;
  };
}
```

In the `startRitual` function, extend the returned object:

```typescript
  return {
    ritualId,
    artifact: snapshot?.artifact,
    roleEvents: snapshot?.roleEvents ?? [],
    developerOutput: snapshot?.developerOutput,
    sandboxApplyResult: snapshot?.sandboxApplyResult
  };
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/actions/startRitual.test.ts
```

Expected: 4 total tests pass (3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/test/actions/startRitual.test.ts
git commit -m "feat(atlas-web): startRitual surfaces sandboxApplyResult in StartRitualResult"
```

---

### Task 15: ChatPanel — render apply-status line in `DeveloperOutputCard`

**Files:**
- Modify: `apps/atlas-web/components/ChatPanel.tsx`
- Modify: `apps/atlas-web/test/components/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("ChatPanel — architect output rendering", ...)` block in `ChatPanel.test.tsx`:

```typescript
  it("renders green '✓ Wrote N files' when sandboxApplyResult.ok && failed===0", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "x", plan: { steps: [{ title: "s" }] } },
      developerOutput: { diff: "diff --git ...", summary: "did it" },
      sandboxApplyResult: {
        ok: true, parsed: 3, written: 3, failed: 0, skipped: 0,
        files: [
          { path: "src/a.ts", status: "written", bytesWritten: 10 },
          { path: "src/b.ts", status: "written", bytesWritten: 20 },
          { path: "src/c.ts", status: "written", bytesWritten: 30 }
        ]
      }
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const apply = await screen.findByTestId("sandbox-apply-status");
    expect(apply).toHaveTextContent(/Wrote 3 files/);
    expect(apply).toHaveTextContent(/refresh the iframe/i);
    expect(apply.className).toContain("emerald"); // green tint
  });

  it("renders amber mixed-result panel when some files failed", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "x", plan: { steps: [{ title: "s" }] } },
      developerOutput: { diff: "diff --git ...", summary: "did it" },
      sandboxApplyResult: {
        ok: false, parsed: 3, written: 1, failed: 1, skipped: 1,
        files: [
          { path: "src/a.ts", status: "written", bytesWritten: 10 },
          { path: "src/b.ts", status: "skipped", reason: "hunk mismatch at line 5" },
          { path: "src/c.ts", status: "failed", reason: "ENOSPC: disk full" }
        ]
      }
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const apply = await screen.findByTestId("sandbox-apply-status");
    expect(apply).toHaveTextContent(/1 of 3/i);
    expect(apply.className).toContain("amber");
    // Per-file detail expandable
    expect(apply).toHaveTextContent(/hunk mismatch at line 5/);
    expect(apply).toHaveTextContent(/ENOSPC: disk full/);
  });

  it("renders red parse-error panel when sandboxApplyResult.parseError set", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "x", plan: { steps: [{ title: "s" }] } },
      developerOutput: { diff: "garbage", summary: "tried" },
      sandboxApplyResult: {
        ok: false, parsed: 0, written: 0, failed: 0, skipped: 0, files: [],
        parseError: "sandbox unavailable: ECONNREFUSED"
      }
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const apply = await screen.findByTestId("sandbox-apply-status");
    expect(apply).toHaveTextContent(/Could not apply/i);
    expect(apply).toHaveTextContent(/sandbox unavailable: ECONNREFUSED/);
    expect(apply.className).toContain("red");
  });

  it("renders nothing when sandboxApplyResult is absent (e.g. cosmetic edit)", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "x", plan: { steps: [{ title: "s" }] } },
      developerOutput: { diff: "diff", summary: "x" }
      // sandboxApplyResult deliberately omitted
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    await screen.findByTestId("developer-output");
    expect(screen.queryByTestId("sandbox-apply-status")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/components/ChatPanel.test.tsx
```

Expected: 4 fails — `sandbox-apply-status` testid not in DOM.

- [ ] **Step 3: Extend `StartRitualResult` type in ChatPanel**

In `apps/atlas-web/components/ChatPanel.tsx`, update the exported `StartRitualResult` interface:

```typescript
export interface StartRitualResult {
  ritualId: string;
  artifact?: unknown;
  roleEvents: RoleEvent[];
  developerOutput?: { diff: string; summary?: string };
  sandboxApplyResult?: {
    ok: boolean;
    parsed: number;
    written: number;
    failed: number;
    skipped: number;
    files: Array<{
      path: string;
      status: "written" | "skipped" | "failed";
      reason?: string;
      bytesWritten?: number;
    }>;
    parseError?: string;
  };
}
```

Pass it into `DeveloperOutputCard`:

```typescript
      {result.developerOutput ? (
        <DeveloperOutputCard
          output={result.developerOutput}
          applyResult={result.sandboxApplyResult}
        />
      ) : developerFailedEvent ? (
```

Update `DeveloperOutputCard`'s signature and body:

```typescript
function DeveloperOutputCard({
  output,
  applyResult
}: {
  output: { diff: string; summary?: string };
  applyResult?: StartRitualResult["sandboxApplyResult"];
}) {
  const fileMatches = output.diff.match(/^diff --git /gm);
  const filesChanged = fileMatches?.length ?? 0;
  const linesChanged = output.diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).length;

  return (
    <div data-testid="developer-output" className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-indigo-900">Developer wrote code</div>
      {output.summary ? <p className="mb-2 text-indigo-900">{output.summary}</p> : null}
      <div className="mb-2 text-indigo-700">
        {filesChanged > 0 ? `${filesChanged} file${filesChanged === 1 ? "" : "s"} changed` : `${linesChanged} lines changed`}
      </div>
      <details>
        <summary className="cursor-pointer text-indigo-900">View diff</summary>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-indigo-100 bg-white p-2 text-[10px] text-slate-800">
          {output.diff}
        </pre>
      </details>
      {applyResult ? <SandboxApplyStatus result={applyResult} /> : (
        <p className="mt-2 text-[10px] italic text-indigo-600">
          Note: diff not yet applied to the live preview sandbox.
        </p>
      )}
    </div>
  );
}

function SandboxApplyStatus({ result }: { result: NonNullable<StartRitualResult["sandboxApplyResult"]> }) {
  if (result.parseError) {
    return (
      <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
        <strong className="block">Could not apply to live preview</strong>
        <span className="block break-words">{result.parseError}</span>
      </div>
    );
  }
  if (result.ok && result.failed === 0 && result.skipped === 0) {
    return (
      <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
        ✓ Wrote {result.written} file{result.written === 1 ? "" : "s"} to live preview — refresh the iframe if it doesn't update automatically.
      </div>
    );
  }
  return (
    <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
      <strong className="block">
        Wrote {result.written} of {result.parsed} files
        {result.skipped > 0 ? `; skipped ${result.skipped}` : ""}
        {result.failed > 0 ? `; failed ${result.failed}` : ""}
      </strong>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {result.files
          .filter((f) => f.status !== "written")
          .map((f, i) => (
            <li key={i}>
              <code>{f.path}</code> — {f.status}
              {f.reason ? `: ${f.reason}` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/components/ChatPanel.test.tsx
```

Expected: 24 total tests pass (20 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/components/ChatPanel.test.tsx
git commit -m "feat(atlas-web): ChatPanel renders sandbox-apply status (green/amber/red panels)"
```

---

### Task 16: End-to-end verification + plan B doc update

**Files:**
- Modify: `docs/superpowers/plans/2026-04-27-plan-c-apply-diff-to-sandbox.md` (mark complete)
- Modify: `docs/superpowers/local-dev-status.md` (move plan C from "deferred" to "wired")

- [ ] **Step 1: Run the full atlas-web suite**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm test
```

Expected: typecheck clean; full suite green. Test counts approximately: factory 14, ChatPanel 24, startRitual 4, apply-diff 31, sandbox-fs-adapter 4, openai-compat-provider 25 (unchanged), other files unchanged. Total ~210+.

- [ ] **Step 2: Run cross-package tests**

```bash
pnpm -F @atlas/ritual-engine test
pnpm -F @atlas/conductor test
pnpm -F @atlas/role-developer test
pnpm -F @atlas/role-architect test
```

Expected: ritual-engine 52 tests (was 49, +3 chain cases); the others unchanged.

- [ ] **Step 3: Manual sign-off click — restart dev server + send a request**

Steps the engineer should take by hand (not scripted):

1. Verify proxy + Postgres + sandbox env vars are set per `docs/superpowers/local-dev-status.md`
2. Restart the dev server: `cd apps/atlas-web && pnpm dev`
3. Navigate to `/projects/<an-existing-project>/canvas`
4. Type "add a login form with email + password fields"
5. Click Send
6. Wait ~50s for the chain
7. Verify:
   - Emerald architect plan card renders
   - Indigo developer card renders
   - Green sandbox-apply status appears below the developer card: "✓ Wrote N files to live preview"
   - Within ~3 seconds, the canvas iframe HMR-refreshes to show the new login form

If the apply status is amber or red, the per-file reasons in the panel tell you which file failed and why — that's the diagnostic surface.

- [ ] **Step 4: Update `docs/superpowers/local-dev-status.md`**

Find the "What's NOT wired (deferred)" section and remove the bullet starting with "Plan C: applying the developer's diff to the live E2B sandbox."

In the "What's wired" section, append after the existing "Failure surfacing" bullet:

```markdown
- **Plan C: developer's diff applied to the live preview sandbox.** Every successful developer dispatch parses the diff via `parse-diff`, writes per-file via `E2BFileSystem.write` to `/code/src/`, and Next.js HMR refreshes the iframe within ~3s. Per-file outcome rendered in ChatPanel as green/amber/red apply-status panel. `applyDiff` never throws — sandbox unavailable, hunk mismatch, path escape all become structured `FileApplyResult` entries.
```

- [ ] **Step 5: Update plan doc with shipped status**

Append to this plan file (`2026-04-27-plan-c-apply-diff-to-sandbox.md`):

```markdown
---

## Shipped

All 16 tasks merged to main. `pnpm typecheck` clean. atlas-web vitest 198 → ~225 tests; ritual-engine 49 → 52. Manual sign-off click verified the apply-status panel and HMR refresh. Plan C closed.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/local-dev-status.md docs/superpowers/plans/2026-04-27-plan-c-apply-diff-to-sandbox.md
git commit -m "docs(plan-c): mark shipped — diff applied to sandbox, status panel green-tested manually"
```

---

## Completion Checklist

After all 16 tasks:

- [ ] `pnpm typecheck` (atlas-web) — clean
- [ ] `pnpm test` (atlas-web) — full suite green; ~225 tests across ~43 files
- [ ] `pnpm -F @atlas/ritual-engine test` — 52 tests green (49 + 3 plan C chain cases)
- [ ] `pnpm -F @atlas/conductor test` — 32 tests green (unchanged)
- [ ] `pnpm -F @atlas/role-developer test` — 30 tests green (unchanged)
- [ ] Manual click: send a structural request from ChatPanel, verify green sandbox-apply status appears within 5s of developer card, verify iframe shows new code
- [ ] Manual error path: stop the proxy mid-ritual, verify red parse-error panel appears with `sandbox unavailable: ECONNREFUSED` message; rest of UI unaffected
- [ ] `docs/superpowers/local-dev-status.md` updated — plan C moved from "deferred" to "wired"
- [ ] This plan file marked Shipped at the bottom

---

## Shipped

All 16 tasks merged to `plan-c/apply-diff-to-sandbox` branch (pending merge to main after the user's manual sign-off click). Per-task commit chain:

| # | Task | Commit |
|---|---|---|
| 1 | parse-diff dep | `5892aa6` |
| 2 | core types | `afb3e7c` |
| 3 | parseDiff happy paths | `f420cfe` |
| 4 | parseDiff edges | `d6e1315` |
| 5 | sanitizePath | `eecfdfc` |
| 6 | applyFileOp(create) | `a8fed90` |
| 7 | applyFileOp(modify) | `054ca0d` + fix `5dca032` (trailing-newline + pure-insertion test) |
| 8 | applyFileOp(delete) | `eae94c6` |
| 9 | applyDiff orchestrator | `83c5171` |
| 10 | sandbox-fs-adapter | `03ff4fb` + fix `4be7f3a` (E2B uses `.files` not `.fs`) |
| 11 | ritual-engine SandboxApplier | `d304ce0` |
| 12 | ritual-engine chain into applier | `b42ffcb` |
| 13 | atlas-web factory wires applier | `fb90278` |
| 14 | startRitual surfaces sandboxApplyResult | `025151e` |
| 15 | ChatPanel apply-status panels | `00fe118` |
| 16 | verification + doc updates | (this commit) |

### Test counts (achieved vs target)

| Package | Plan target | Achieved |
|---|---|---|
| `@atlas/ritual-engine` | 49 → 52 | ✅ 52 |
| `@atlas/conductor` | 32 (unchanged) | ✅ 32 |
| `@atlas/role-developer` | 30 (unchanged) | ✅ 30 |
| `apps/atlas-web` (vitest) | 198 → ~225 | ✅ 252 (245 + 7 known parallel-load timeouts; pass in isolation) |

Workspace `pnpm typecheck` clean.

### Known issues found during execution + resolved before completion

- **T7 algorithm bug** — `reconstructFromChunks` did not preserve trailing-newline state (could silently add `\n` to files lacking one). Caught by code-quality reviewer; fix landed in `5dca032` with two regression tests + a pure-insertion-hunk test.
- **T10 API mismatch** — adapter wrote `session.fs.*` but the real E2B SDK exposes `session.files.*`. Caught by code-quality reviewer; fix landed in `4be7f3a`.
- **T13 integration gap** — the plan's spec assumed `SandboxSession` had `.files`, but it didn't. Implementer used `Sandbox.connect(sandboxId, { apiKey })` to re-attach to the running sandbox via the E2B SDK directly. Cleaner than plumbing the SDK handle through SandboxSession; no cross-package change needed.

### Outstanding (acceptable, deferred)

- The atlas-web full-suite parallel-load flakes (7 5s-timeout-on-dynamic-import) are pre-existing per the audit doc and re-run cleanly in isolation. Not a plan-C regression.
- Manual sign-off click is the user's verification step — they trigger ChatPanel and observe the green apply-status panel + iframe HMR refresh.
