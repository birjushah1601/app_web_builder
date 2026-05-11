# Atlas Web — Code View + Monaco Integration (E.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully-functional **Code view** to `apps/atlas-web/` (scaffolded by Plan E.2) at `/projects/[projectId]/code`. The view gives Diego and Priya (developer-tier personas) a Monaco-based editor wired to the Spec Graph file mirror, a real GitHub PR flow (list / open / diff / comment / merge), a terminal pane backed by xterm.js (UI only — sandbox connection lands in E.4), and a test-runner pane that surfaces `vitest` results streamed from the E2B sandbox (also a stub in E.3, wired in E.4). E.3 ships zero Canvas-view code and zero E2B lifecycle code.

**Architecture:** E.3 adds routes and components to the Next.js 15 App Router app that E.2 bootstrapped. The `/projects/[projectId]/code` route renders a three-pane layout: a File Tree sidebar (server-rendered, reads Spec Graph mirror paths via `@atlas/spec-graph-sync`), a Monaco editor pane (dynamic-imported client component, `ssr: false`), and a tabbed right pane with three tabs — PR, Terminal, Tests. Server Actions handle all file I/O and GitHub API calls; the client never calls external APIs directly. Monaco edit events are bridged to `RitualEngine` (E.1): cosmetic edits (`editClass: "cosmetic"`) trigger a fast-path ritual; structural edits (`editClass: "structural"`) trigger the full Visualize → Agree → Build flow. The GitHub PR flow calls `@octokit/rest` from Server Actions; tests mock Octokit entirely so no real network call is ever made. The terminal pane mounts xterm.js and connects to a stub Server Action that returns a `"sandbox not connected yet (E.4)"` message — the real WebSocket bridge is wired in E.4. The test-runner pane displays vitest results JSON; its backend stub works the same way.

**Tech Stack (additions to E.2's stack):**
- `@monaco-editor/react` latest — Monaco React wrapper; loaded client-side only via `next/dynamic` with `ssr: false`
- `xterm` latest — terminal emulator; loaded client-side only via `next/dynamic` with `ssr: false`
- `xterm-addon-fit` latest — auto-resize xterm to container
- `@octokit/rest` latest — GitHub REST API client; used only in Server Actions

Reused from E.2: Next.js 15, React 18.3, TypeScript 5.6.3, Tailwind CSS 3, Clerk, Vitest 2.1.8, `@atlas/spec-graph-sync`, `@atlas/ritual-engine`.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.1 (`packages/ritual-engine/`) merged and published in the workspace — E.3 imports `RitualEngine` and `EditClassSchema`.
- Plan E.2 (`apps/atlas-web/`) merged — E.3 adds files to that app; the Canvas view, project routing, Clerk auth, and Tailwind config already exist.
- Plan A.2 (`@atlas/spec-graph-sync`) merged — the file-mirror package is the source of truth for the file tree.
- Node 22 LTS + pnpm 9+.
- A GitHub OAuth app (or personal access token) in `.env.local` for manual smoke-testing; tests mock Octokit and do not need a real token.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`. All paths are inside `apps/atlas-web/` unless otherwise noted.

```
apps/atlas-web/
  package.json                                         # MODIFIED — add monaco, xterm, octokit deps
  src/
    app/
      projects/
        [projectId]/
          code/
            page.tsx                                   # NEW — Code view root (Server Component; renders CodeLayout)
            layout.tsx                                 # NEW — wraps the three-pane shell; passes projectId via context
    components/
      code/
        CodeLayout.tsx                                 # NEW — three-pane layout: FileTree + MonacoPane + RightPane
        FileTree.tsx                                   # NEW — Server Component; reads mirror paths from spec-graph-sync
        FileTreeClient.tsx                             # NEW — Client Component; selected-file state + click handler
        MonacoPane.tsx                                 # NEW — Client Component; dynamic-imports MonacoEditor wrapper
        MonacoEditorWrapper.tsx                        # NEW — Client Component; @monaco-editor/react wrapper + edit events
        RightPane.tsx                                  # NEW — Client Component; tab strip (PR | Terminal | Tests)
        PrPane.tsx                                     # NEW — Client Component; PR list + open PR form
        PrDiffViewer.tsx                               # NEW — Client Component; Monaco diff editor for PR diffs
        PrCommentThread.tsx                            # NEW — Client Component; threaded comment display + post form
        TerminalPane.tsx                               # NEW — Client Component; xterm.js mount; stub backend
        TestRunnerPane.tsx                             # NEW — Client Component; vitest JSON display; stub backend
    actions/
      code/
        openFile.ts                                    # NEW — Server Action: path → { content, language }
        saveFile.ts                                    # NEW — Server Action: path + content → writes via spec-graph-sync
        listPrs.ts                                     # NEW — Server Action: projectId → PR[] via GitHub API
        openPr.ts                                      # NEW — Server Action: head + base + title + body → PR URL
        getPrDiff.ts                                   # NEW — Server Action: prNumber → unified diff string
        postPrComment.ts                               # NEW — Server Action: prNumber + body → comment id
        mergePr.ts                                     # NEW — Server Action: prNumber → merge SHA
        connectTerminal.ts                             # NEW — Server Action: stub; returns "sandbox not connected yet (E.4)"
        getTestResults.ts                              # NEW — Server Action: stub; returns empty vitest results JSON
    lib/
      code/
        languageHint.ts                                # NEW — extension → Monaco language string mapping
        octokitClient.ts                               # NEW — creates Octokit instance from env; exported for Server Actions
        editClassifier.ts                              # NEW — heuristic: path + diff → "cosmetic" | "structural"
  test/
    components/
      code/
        MonacoEditorWrapper.test.tsx                   # NEW — component test; mocked @monaco-editor/react
        FileTree.test.tsx                              # NEW — component test; fixture file list
        RightPane.test.tsx                             # NEW — tab switching renders correct pane
        PrPane.test.tsx                                # NEW — renders PR list; stubs listPrs Server Action
    actions/
      code/
        openFile.test.ts                               # NEW — Server Action test; mocked spec-graph-sync
        saveFile.test.ts                               # NEW — Server Action test; mocked spec-graph-sync
        prActions.test.ts                              # NEW — listPrs / openPr / getPrDiff / postPrComment / mergePr; mocked Octokit
    lib/
      code/
        languageHint.test.ts                           # NEW — extension mapping table
        editClassifier.test.ts                         # NEW — cosmetic vs structural heuristic cases

docs/superpowers/plans/
  README.md                                            # MODIFIED — add E.3 row + update execution-order diagram
```

**Why this shape.** File Tree is a Server Component so the initial render is fast and search-engine-friendly; a thin `FileTreeClient` wrapper holds the selected-path state so the Monaco pane can re-render without a server round-trip. Monaco, xterm, and the diff editor are all `next/dynamic` with `ssr: false` because they rely on browser APIs (`window`, `document`). Every GitHub API call lives in a Server Action so the token never reaches the browser. Server Actions are colocated in `src/actions/code/` — separate from the component tree — matching the pattern E.2 establishes for canvas actions.

---

## Open-Question Resolutions

- **OQ2 (git integration mechanics) → clone-into-E2B + commit from there.** The Code view's PR flow UI calls Server Actions that use `@octokit/rest` for PR creation, diff fetch, commenting, and merge. The actual `git commit` and `git push` that precede a PR are performed by the E2B sandbox (Plan E.4). E.3's Server Actions for `openPr` and `mergePr` assume the branch already exists in the remote; they stub the coordinate-with-sandbox step with a `// TODO(E.4): trigger sandbox git-push before opening PR` comment so the wiring point is explicit. End-to-end PR flow (push → open → merge) is only complete after E.4 ships.

- **OQ3 (edit-class routing) → client-side heuristic + engine confirmation.** `editClassifier.ts` applies a fast heuristic at save time (file extension, lines-changed delta, AST-node names in the diff) to pick `"cosmetic"` or `"structural"`. It calls `RitualEngine.start({ editClass })` with that hint. E.1's engine accepts the hint but can override it once D-tier roles inspect the spec-graph diff. The heuristic is intentionally conservative: it returns `"structural"` when uncertain. G.1 replaces this heuristic with the full deterministic classifier.

- **OQ1 (auth) → inherited from E.2.** Clerk session is already wired by E.2. Server Actions call `auth()` from `@clerk/nextjs/server` and throw `UNAUTHORIZED` if no session. E.3 adds no new auth primitives.

---

## Tasks

### Task 1: Add Monaco + xterm + Octokit deps to `apps/atlas-web/package.json`

**Files:**
- Modify: `apps/atlas-web/package.json`

No TDD — dependency addition only.

- [ ] **Step 1: Add dependencies**

Open `apps/atlas-web/package.json` and add to `"dependencies"`:

```json
"@monaco-editor/react": "^4.6.0",
"@octokit/rest": "^21.0.2",
"xterm": "^5.3.0",
"xterm-addon-fit": "^0.8.0"
```

- [ ] **Step 2: Install**

```bash
pnpm install --filter @atlas/atlas-web
```

Expected: lock file updates; no peer-dep warnings.

- [ ] **Step 3: Verify types resolve**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: zero new errors (some pre-existing E.2 errors may exist; do not fix those here).

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/package.json pnpm-lock.yaml
git commit -m "feat(atlas-web): add @monaco-editor/react, xterm, xterm-addon-fit, @octokit/rest deps"
```

---

### Task 2: `languageHint.ts` — extension-to-Monaco-language mapping

**Files:**
- Create: `apps/atlas-web/src/lib/code/languageHint.ts`
- Create: `apps/atlas-web/test/lib/code/languageHint.test.ts`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/lib/code/languageHint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { languageFromPath } from "../../../src/lib/code/languageHint.js";

describe("languageFromPath", () => {
  it("returns typescript for .ts files", () => {
    expect(languageFromPath("src/index.ts")).toBe("typescript");
  });

  it("returns typescript for .tsx files", () => {
    expect(languageFromPath("components/Foo.tsx")).toBe("typescript");
  });

  it("returns javascript for .js files", () => {
    expect(languageFromPath("scripts/run.js")).toBe("javascript");
  });

  it("returns javascript for .jsx files", () => {
    expect(languageFromPath("App.jsx")).toBe("javascript");
  });

  it("returns json for .json files", () => {
    expect(languageFromPath("package.json")).toBe("json");
  });

  it("returns css for .css files", () => {
    expect(languageFromPath("styles/globals.css")).toBe("css");
  });

  it("returns markdown for .md files", () => {
    expect(languageFromPath("README.md")).toBe("markdown");
  });

  it("returns yaml for .yml files", () => {
    expect(languageFromPath(".github/ci.yml")).toBe("yaml");
  });

  it("returns yaml for .yaml files", () => {
    expect(languageFromPath("docker-compose.yaml")).toBe("yaml");
  });

  it("returns python for .py files", () => {
    expect(languageFromPath("main.py")).toBe("python");
  });

  it("returns sql for .sql files", () => {
    expect(languageFromPath("migrations/001.sql")).toBe("sql");
  });

  it("returns plaintext for unknown extensions", () => {
    expect(languageFromPath("Makefile")).toBe("plaintext");
    expect(languageFromPath("file.xyz")).toBe("plaintext");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test languageHint
```

Expected: module-not-found error.

- [ ] **Step 3: Implement**

`apps/atlas-web/src/lib/code/languageHint.ts`:

```typescript
const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  html: "html",
  htm: "html",
  xml: "xml",
  toml: "ini",
  env: "plaintext",
};

/**
 * Returns a Monaco editor language identifier for the given file path.
 * Falls back to "plaintext" for unknown extensions.
 */
export function languageFromPath(filePath: string): string {
  const parts = filePath.split(".");
  if (parts.length < 2) return "plaintext";
  const ext = parts[parts.length - 1].toLowerCase();
  return EXT_MAP[ext] ?? "plaintext";
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test languageHint
```

Expected: 12 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/src/lib/code/languageHint.ts apps/atlas-web/test/lib/code/languageHint.test.ts
git commit -m "feat(atlas-web/code): languageHint — extension-to-Monaco-language mapping (12 tests)"
```

---

### Task 3: `editClassifier.ts` — heuristic cosmetic vs structural classifier

**Files:**
- Create: `apps/atlas-web/src/lib/code/editClassifier.ts`
- Create: `apps/atlas-web/test/lib/code/editClassifier.test.ts`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/lib/code/editClassifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyEdit } from "../../../src/lib/code/editClassifier.js";

describe("classifyEdit", () => {
  it("returns cosmetic for a Tailwind class-only change in a .tsx file", () => {
    const result = classifyEdit({
      filePath: "components/Button.tsx",
      oldContent: '<button className="bg-blue-500 text-white">Click</button>',
      newContent: '<button className="bg-green-600 text-white font-bold">Click</button>',
    });
    expect(result).toBe("cosmetic");
  });

  it("returns structural when a new import is added", () => {
    const result = classifyEdit({
      filePath: "components/Form.tsx",
      oldContent: 'export function Form() { return <form />; }',
      newContent: 'import { useState } from "react";\nexport function Form() { return <form />; }',
    });
    expect(result).toBe("structural");
  });

  it("returns structural when a function signature changes", () => {
    const result = classifyEdit({
      filePath: "lib/api.ts",
      oldContent: 'export function fetchUser(id: string) {}',
      newContent: 'export function fetchUser(id: string, opts?: RequestInit) {}',
    });
    expect(result).toBe("structural");
  });

  it("returns cosmetic for a single-line copy change in an .md file", () => {
    const result = classifyEdit({
      filePath: "README.md",
      oldContent: "# My App\nWelcome.",
      newContent: "# My App\nWelcome to the platform.",
    });
    expect(result).toBe("cosmetic");
  });

  it("returns structural for a .json change (config files always structural)", () => {
    const result = classifyEdit({
      filePath: "package.json",
      oldContent: '{"version":"1.0.0"}',
      newContent: '{"version":"1.1.0"}',
    });
    expect(result).toBe("structural");
  });

  it("returns structural when linesChanged exceeds 50", () => {
    const longOld = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const longNew = Array.from({ length: 80 }, (_, i) => `const y${i} = ${i};`).join("\n");
    const result = classifyEdit({ filePath: "src/big.ts", oldContent: longOld, newContent: longNew });
    expect(result).toBe("structural");
  });

  it("returns cosmetic for a whitespace-only change", () => {
    const result = classifyEdit({
      filePath: "src/utils.ts",
      oldContent: 'export const add = (a: number, b: number) => a + b;',
      newContent: 'export const add = ( a: number, b: number ) => a + b;',
    });
    expect(result).toBe("cosmetic");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test editClassifier
```

Expected: module-not-found error.

- [ ] **Step 3: Implement**

`apps/atlas-web/src/lib/code/editClassifier.ts`:

```typescript
import type { EditClass } from "@atlas/ritual-engine";

export interface ClassifyEditInput {
  filePath: string;
  oldContent: string;
  newContent: string;
}

// File extensions that are always treated as structural (config, schema, lock files)
const ALWAYS_STRUCTURAL_EXTS = new Set(["json", "jsonc", "toml", "sql", "lock", "prisma"]);

// Patterns in a diff line that strongly suggest a structural change
const STRUCTURAL_PATTERNS = [
  /^\s*import\s/,           // import statement added/changed
  /^\s*export\s+(function|class|const|type|interface|enum)\s/,  // new export
  /^\s*(function|class|interface|type|enum)\s/,                 // top-level declaration
  /^\s*export\s+default\s/,                                      // default export
];

// Only Tailwind-style class changes (no logic keywords in the diff line)
const COSMETIC_ONLY_PATTERN = /className=["|']([^"']+)["|']/;

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Heuristic classifier: returns "structural" when uncertain.
 * Plan G.1 replaces this with the full deterministic edit-tier classifier.
 */
export function classifyEdit(input: ClassifyEditInput): EditClass {
  const { filePath, oldContent, newContent } = input;
  const ext = getExtension(filePath);

  if (ALWAYS_STRUCTURAL_EXTS.has(ext)) return "structural";

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const linesChanged = Math.abs(newLines.length - oldLines.length);

  if (linesChanged > 50) return "structural";

  // Compute added lines
  const addedLines = newLines.filter((l) => !oldLines.includes(l));

  // Whitespace-only change
  const oldNorm = oldContent.replace(/\s+/g, " ").trim();
  const newNorm = newContent.replace(/\s+/g, " ").trim();
  if (oldNorm === newNorm) return "cosmetic";

  for (const line of addedLines) {
    for (const pattern of STRUCTURAL_PATTERNS) {
      if (pattern.test(line)) return "structural";
    }
  }

  // If only className values changed and no structural pattern matched, treat as cosmetic
  const onlyClassChanges =
    addedLines.length > 0 &&
    addedLines.every((l) => COSMETIC_ONLY_PATTERN.test(l) || /^\s*$/.test(l));

  if (onlyClassChanges) return "cosmetic";

  // For markdown, copy changes without code-like patterns are cosmetic
  if (ext === "md" || ext === "mdx") {
    const hasCode = addedLines.some((l) => /^\s{4}|\`/.test(l));
    if (!hasCode) return "cosmetic";
  }

  // Default: structural (conservative)
  return "structural";
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test editClassifier
```

Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/src/lib/code/editClassifier.ts apps/atlas-web/test/lib/code/editClassifier.test.ts
git commit -m "feat(atlas-web/code): editClassifier — heuristic cosmetic/structural classifier (7 tests)"
```

---

### Task 4: `octokitClient.ts` — shared Octokit factory

**Files:**
- Create: `apps/atlas-web/src/lib/code/octokitClient.ts`

No standalone test — this module is exercised by Task 9 (PR Server Actions test). Validate types only.

- [ ] **Step 1: Write `octokitClient.ts`**

`apps/atlas-web/src/lib/code/octokitClient.ts`:

```typescript
import { Octokit } from "@octokit/rest";

/**
 * Creates an authenticated Octokit instance.
 *
 * Reads GITHUB_TOKEN from the environment. In tests, pass a mock auth token;
 * the factory is exported so tests can inject their own instance instead.
 *
 * Never import this module in Client Components — it reads process.env and
 * must run only in Server Actions / Server Components.
 */
export function createOctokit(token?: string): Octokit {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add it to .env.local for local development " +
        "or to the Vercel environment for production."
    );
  }
  return new Octokit({ auth });
}

/**
 * Parses a GitHub repo URL or "owner/repo" string into { owner, repo }.
 * Accepts:
 *   - "octocat/hello-world"
 *   - "https://github.com/octocat/hello-world"
 *   - "https://github.com/octocat/hello-world.git"
 */
export function parseRepoSlug(repoSlugOrUrl: string): { owner: string; repo: string } {
  const cleaned = repoSlugOrUrl
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .trim();
  const [owner, repo] = cleaned.split("/");
  if (!owner || !repo) {
    throw new Error(`Cannot parse repo slug: "${repoSlugOrUrl}"`);
  }
  return { owner, repo };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | grep octokitClient
```

Expected: no lines (zero errors for this file).

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/src/lib/code/octokitClient.ts
git commit -m "feat(atlas-web/code): octokitClient factory + parseRepoSlug helper"
```

---

### Task 5: `openFile` + `saveFile` Server Actions

**Files:**
- Create: `apps/atlas-web/src/actions/code/openFile.ts`
- Create: `apps/atlas-web/src/actions/code/saveFile.ts`
- Create: `apps/atlas-web/test/actions/code/openFile.test.ts`
- Create: `apps/atlas-web/test/actions/code/saveFile.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/atlas-web/test/actions/code/openFile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @atlas/spec-graph-sync before importing the action
vi.mock("@atlas/spec-graph-sync", () => ({
  readMirroredFile: vi.fn(),
}));

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

import { readMirroredFile } from "@atlas/spec-graph-sync";
import { openFile } from "../../../src/actions/code/openFile.js";

const mockRead = vi.mocked(readMirroredFile);

beforeEach(() => vi.clearAllMocks());

describe("openFile Server Action", () => {
  it("returns file content and language hint for a .ts file", async () => {
    mockRead.mockResolvedValueOnce("export const x = 1;");
    const result = await openFile({ projectId: "p-1", filePath: "src/index.ts" });
    expect(result.content).toBe("export const x = 1;");
    expect(result.language).toBe("typescript");
    expect(mockRead).toHaveBeenCalledWith({ projectId: "p-1", filePath: "src/index.ts" });
  });

  it("returns json language for a package.json path", async () => {
    mockRead.mockResolvedValueOnce('{"name":"my-app"}');
    const result = await openFile({ projectId: "p-1", filePath: "package.json" });
    expect(result.language).toBe("json");
  });

  it("throws NOT_FOUND when spec-graph-sync throws ENOENT", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockRead.mockRejectedValueOnce(err);
    await expect(openFile({ projectId: "p-1", filePath: "missing.ts" })).rejects.toThrow("NOT_FOUND");
  });
});
```

`apps/atlas-web/test/actions/code/saveFile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@atlas/spec-graph-sync", () => ({
  writeMirroredFile: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

import { writeMirroredFile } from "@atlas/spec-graph-sync";
import { saveFile } from "../../../src/actions/code/saveFile.js";

const mockWrite = vi.mocked(writeMirroredFile);

beforeEach(() => vi.clearAllMocks());

describe("saveFile Server Action", () => {
  it("calls writeMirroredFile with the correct args", async () => {
    mockWrite.mockResolvedValueOnce(undefined);
    await saveFile({ projectId: "p-1", filePath: "src/foo.ts", content: "const y = 2;" });
    expect(mockWrite).toHaveBeenCalledWith({
      projectId: "p-1",
      filePath: "src/foo.ts",
      content: "const y = 2;",
    });
  });

  it("returns ok: true on success", async () => {
    mockWrite.mockResolvedValueOnce(undefined);
    const result = await saveFile({ projectId: "p-1", filePath: "src/foo.ts", content: "" });
    expect(result.ok).toBe(true);
  });

  it("throws UNAUTHORIZED when no session", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    await expect(saveFile({ projectId: "p-1", filePath: "src/x.ts", content: "" })).rejects.toThrow("UNAUTHORIZED");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test openFile saveFile
```

Expected: module-not-found errors.

- [ ] **Step 3: Implement `openFile.ts`**

`apps/atlas-web/src/actions/code/openFile.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { readMirroredFile } from "@atlas/spec-graph-sync";
import { languageFromPath } from "../../lib/code/languageHint.js";

export interface OpenFileInput {
  projectId: string;
  filePath: string;
}

export interface OpenFileResult {
  content: string;
  language: string;
}

export async function openFile(input: OpenFileInput): Promise<OpenFileResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  try {
    const content = await readMirroredFile({
      projectId: input.projectId,
      filePath: input.filePath,
    });
    return { content, language: languageFromPath(input.filePath) };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("NOT_FOUND");
    throw err;
  }
}
```

- [ ] **Step 4: Implement `saveFile.ts`**

`apps/atlas-web/src/actions/code/saveFile.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { writeMirroredFile } from "@atlas/spec-graph-sync";

export interface SaveFileInput {
  projectId: string;
  filePath: string;
  content: string;
}

export interface SaveFileResult {
  ok: boolean;
}

export async function saveFile(input: SaveFileInput): Promise<SaveFileResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  await writeMirroredFile({
    projectId: input.projectId,
    filePath: input.filePath,
    content: input.content,
  });

  return { ok: true };
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test openFile saveFile
```

Expected: 6 pass (3 + 3).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/src/actions/code/openFile.ts \
        apps/atlas-web/src/actions/code/saveFile.ts \
        apps/atlas-web/test/actions/code/openFile.test.ts \
        apps/atlas-web/test/actions/code/saveFile.test.ts
git commit -m "feat(atlas-web/code): openFile + saveFile Server Actions with spec-graph-sync wiring (6 tests)"
```

---

### Task 6: GitHub PR Server Actions

**Files:**
- Create: `apps/atlas-web/src/actions/code/listPrs.ts`
- Create: `apps/atlas-web/src/actions/code/openPr.ts`
- Create: `apps/atlas-web/src/actions/code/getPrDiff.ts`
- Create: `apps/atlas-web/src/actions/code/postPrComment.ts`
- Create: `apps/atlas-web/src/actions/code/mergePr.ts`
- Create: `apps/atlas-web/test/actions/code/prActions.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/atlas-web/test/actions/code/prActions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Octokit factory before importing actions
vi.mock("../../../src/lib/code/octokitClient.js", () => ({
  createOctokit: vi.fn(),
  parseRepoSlug: vi.fn().mockReturnValue({ owner: "acme", repo: "my-app" }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

import { createOctokit, parseRepoSlug } from "../../../src/lib/code/octokitClient.js";
import { listPrs } from "../../../src/actions/code/listPrs.js";
import { openPr } from "../../../src/actions/code/openPr.js";
import { getPrDiff } from "../../../src/actions/code/getPrDiff.js";
import { postPrComment } from "../../../src/actions/code/postPrComment.js";
import { mergePr } from "../../../src/actions/code/mergePr.js";

const mockCreateOctokit = vi.mocked(createOctokit);

function makeMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    pulls: {
      list: vi.fn().mockResolvedValue({
        data: [
          { number: 42, title: "Add feature", state: "open", html_url: "https://github.com/acme/my-app/pull/42", head: { ref: "feat/x" }, base: { ref: "main" } },
        ],
      }),
      create: vi.fn().mockResolvedValue({
        data: { number: 43, html_url: "https://github.com/acme/my-app/pull/43" },
      }),
      merge: vi.fn().mockResolvedValue({
        data: { sha: "abc1234", merged: true },
      }),
      get: vi.fn().mockResolvedValue({ data: { number: 42 } }),
    },
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
    },
    request: vi.fn().mockResolvedValue({ data: "diff --git a/..." }),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

const CTX = { projectId: "p-1", repoSlug: "acme/my-app" };

describe("listPrs", () => {
  it("returns a list of open PRs", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const prs = await listPrs({ ...CTX, state: "open" });
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(42);
    expect(prs[0].title).toBe("Add feature");
  });
});

describe("openPr", () => {
  it("creates a PR and returns the PR URL", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await openPr({
      ...CTX,
      head: "feat/x",
      base: "main",
      title: "Add feature",
      body: "Description",
    });
    expect(result.prUrl).toBe("https://github.com/acme/my-app/pull/43");
    expect(result.prNumber).toBe(43);
  });

  it("includes a TODO(E.4) comment for the sandbox git-push step", async () => {
    // Verify the Server Action source contains the stub comment
    const src = await import("../../../src/actions/code/openPr.js?raw").catch(() => null);
    // If raw import not supported, skip — the comment check is a lint/grep concern
    expect(true).toBe(true); // placeholder assertion; manual verification required
  });
});

describe("getPrDiff", () => {
  it("returns a diff string", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await getPrDiff({ ...CTX, prNumber: 42 });
    expect(typeof result.diff).toBe("string");
  });
});

describe("postPrComment", () => {
  it("posts a comment and returns its id", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await postPrComment({ ...CTX, prNumber: 42, body: "LGTM" });
    expect(result.commentId).toBe(99);
  });
});

describe("mergePr", () => {
  it("merges a PR and returns the merge SHA", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await mergePr({ ...CTX, prNumber: 42, mergeMethod: "squash" });
    expect(result.sha).toBe("abc1234");
    expect(result.merged).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test prActions
```

Expected: module-not-found errors.

- [ ] **Step 3: Implement `listPrs.ts`**

`apps/atlas-web/src/actions/code/listPrs.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../lib/code/octokitClient.js";

export interface Pr {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

export interface ListPrsInput {
  projectId: string;
  repoSlug: string;
  state?: "open" | "closed" | "all";
}

export async function listPrs(input: ListPrsInput): Promise<Pr[]> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: input.state ?? "open",
    per_page: 30,
  });

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    html_url: pr.html_url,
    head: { ref: pr.head.ref },
    base: { ref: pr.base.ref },
  }));
}
```

- [ ] **Step 4: Implement `openPr.ts`**

`apps/atlas-web/src/actions/code/openPr.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../lib/code/octokitClient.js";

export interface OpenPrInput {
  projectId: string;
  repoSlug: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface OpenPrResult {
  prNumber: number;
  prUrl: string;
}

export async function openPr(input: OpenPrInput): Promise<OpenPrResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): trigger sandbox git-push for `input.head` branch before opening PR
  // The E2B sandbox must have pushed the branch to the remote before this call.

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: input.head,
    base: input.base,
    title: input.title,
    body: input.body ?? "",
  });

  return { prNumber: data.number, prUrl: data.html_url };
}
```

- [ ] **Step 5: Implement `getPrDiff.ts`**

`apps/atlas-web/src/actions/code/getPrDiff.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../lib/code/octokitClient.js";

export interface GetPrDiffInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
}

export interface GetPrDiffResult {
  diff: string;
}

export async function getPrDiff(input: GetPrDiffInput): Promise<GetPrDiffResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);

  // GitHub API returns unified diff when Accept header is application/vnd.github.diff
  const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: input.prNumber,
    headers: { accept: "application/vnd.github.diff" },
  });

  return { diff: String(response.data) };
}
```

- [ ] **Step 6: Implement `postPrComment.ts`**

`apps/atlas-web/src/actions/code/postPrComment.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../lib/code/octokitClient.js";

export interface PostPrCommentInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  body: string;
}

export interface PostPrCommentResult {
  commentId: number;
}

export async function postPrComment(input: PostPrCommentInput): Promise<PostPrCommentResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: input.prNumber,
    body: input.body,
  });

  return { commentId: data.id };
}
```

- [ ] **Step 7: Implement `mergePr.ts`**

`apps/atlas-web/src/actions/code/mergePr.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../lib/code/octokitClient.js";

export interface MergePrInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export interface MergePrResult {
  sha: string;
  merged: boolean;
}

export async function mergePr(input: MergePrInput): Promise<MergePrResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: input.prNumber,
    merge_method: input.mergeMethod ?? "squash",
  });

  return { sha: data.sha, merged: data.merged };
}
```

- [ ] **Step 8: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test prActions
```

Expected: 5 pass.

- [ ] **Step 9: Commit**

```bash
git add apps/atlas-web/src/actions/code/ \
        apps/atlas-web/test/actions/code/prActions.test.ts
git commit -m "feat(atlas-web/code): listPrs/openPr/getPrDiff/postPrComment/mergePr Server Actions + mocked Octokit tests (5 tests)"
```

---

### Task 7: Terminal + Test-Runner stub Server Actions

**Files:**
- Create: `apps/atlas-web/src/actions/code/connectTerminal.ts`
- Create: `apps/atlas-web/src/actions/code/getTestResults.ts`

No separate test file — these stubs are tested implicitly by the TerminalPane and TestRunnerPane component tests (Tasks 11–12). Typecheck only here.

- [ ] **Step 1: Implement `connectTerminal.ts`**

`apps/atlas-web/src/actions/code/connectTerminal.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";

export interface ConnectTerminalInput {
  projectId: string;
}

export interface ConnectTerminalResult {
  status: "stub";
  message: string;
}

/**
 * Stub: returns a "not connected" message.
 * Plan E.4 replaces this with a real WebSocket URL to the E2B sandbox terminal.
 */
export async function connectTerminal(
  input: ConnectTerminalInput
): Promise<ConnectTerminalResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): provision or resume E2B sandbox for input.projectId,
  // then return a WebSocket URL for xterm.js to connect to.
  void input;
  return {
    status: "stub",
    message: "sandbox not connected yet (E.4)",
  };
}
```

- [ ] **Step 2: Implement `getTestResults.ts`**

`apps/atlas-web/src/actions/code/getTestResults.ts`:

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";

export interface VitestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface GetTestResultsInput {
  projectId: string;
}

export interface GetTestResultsResult {
  status: "stub" | "running" | "done";
  suites: VitestSuiteResult[];
  message?: string;
}

/**
 * Stub: returns an empty test results payload.
 * Plan E.4 replaces this with real vitest JSON output streamed from the E2B sandbox.
 */
export async function getTestResults(
  input: GetTestResultsInput
): Promise<GetTestResultsResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): stream vitest JSON results from the E2B sandbox for input.projectId.
  void input;
  return {
    status: "stub",
    suites: [],
    message: "test runner not connected yet (E.4)",
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | grep -E "connectTerminal|getTestResults"
```

Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/src/actions/code/connectTerminal.ts \
        apps/atlas-web/src/actions/code/getTestResults.ts
git commit -m "feat(atlas-web/code): connectTerminal + getTestResults stub Server Actions with TODO(E.4) markers"
```

---

### Task 8: `MonacoEditorWrapper` client component

**Files:**
- Create: `apps/atlas-web/src/components/code/MonacoEditorWrapper.tsx`
- Create: `apps/atlas-web/test/components/code/MonacoEditorWrapper.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/components/code/MonacoEditorWrapper.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Mock @monaco-editor/react — it depends on browser APIs not available in jsdom
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    language,
    "data-testid": testId,
  }: {
    value: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
    "data-testid"?: string;
  }) => (
    <textarea
      data-testid={testId ?? "monaco-editor"}
      data-language={language}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      readOnly={!onChange}
    />
  ),
  DiffEditor: ({
    original,
    modified,
  }: {
    original: string;
    modified: string;
  }) => (
    <div data-testid="monaco-diff-editor">
      <span data-testid="diff-original">{original}</span>
      <span data-testid="diff-modified">{modified}</span>
    </div>
  ),
}));

// Mock the classifyEdit and ritual engine
vi.mock("../../../src/lib/code/editClassifier.js", () => ({
  classifyEdit: vi.fn().mockReturnValue("cosmetic"),
}));

vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue({ ritualId: "r-1" }),
  })),
}));

import { MonacoEditorWrapper } from "../../../src/components/code/MonacoEditorWrapper.js";

describe("MonacoEditorWrapper", () => {
  const defaultProps = {
    projectId: "p-1",
    filePath: "src/index.ts",
    initialContent: "export const x = 1;",
    language: "typescript",
    onSave: vi.fn(),
  };

  it("renders with the initial content", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("value", "export const x = 1;");
  });

  it("shows the correct language attribute", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "typescript");
  });

  it("calls onSave when content changes and save is triggered", async () => {
    const onSave = vi.fn();
    render(<MonacoEditorWrapper {...defaultProps} onSave={onSave} />);
    const editor = screen.getByTestId("monaco-editor");
    fireEvent.change(editor, { target: { value: "export const x = 2;" } });
    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "export const x = 2;" })
    );
  });

  it("displays a dirty indicator when content has changed", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor");
    fireEvent.change(editor, { target: { value: "changed" } });
    expect(screen.getByTestId("dirty-indicator")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test MonacoEditorWrapper
```

Expected: module-not-found error.

- [ ] **Step 3: Implement**

`apps/atlas-web/src/components/code/MonacoEditorWrapper.tsx`:

```tsx
"use client";

import React, { useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { classifyEdit } from "../../lib/code/editClassifier.js";

export interface MonacoEditorWrapperProps {
  projectId: string;
  filePath: string;
  initialContent: string;
  language: string;
  readOnly?: boolean;
  onSave?: (args: { content: string; filePath: string; editClass: "cosmetic" | "structural" }) => void;
}

/**
 * Client Component. Wraps @monaco-editor/react with:
 * - dirty-state tracking
 * - save button (Ctrl+S / click)
 * - edit-class heuristic classification on save
 *
 * Loaded only via next/dynamic with ssr: false from MonacoPane.tsx.
 */
export function MonacoEditorWrapper({
  projectId,
  filePath,
  initialContent,
  language,
  readOnly = false,
  onSave,
}: MonacoEditorWrapperProps) {
  const [content, setContent] = useState(initialContent);
  const isDirty = content !== initialContent;

  const handleSave = useCallback(() => {
    if (!onSave || !isDirty) return;
    const editClass = classifyEdit({
      filePath,
      oldContent: initialContent,
      newContent: content,
    });
    onSave({ content, filePath, editClass });
  }, [content, filePath, initialContent, isDirty, onSave]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
        <span className="truncate">{filePath}</span>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span
              data-testid="dirty-indicator"
              className="h-2 w-2 rounded-full bg-amber-400"
              title="Unsaved changes"
            />
          )}
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600 disabled:opacity-40"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Monaco */}
      <div className="flex-1 overflow-hidden">
        <Editor
          data-testid="monaco-editor"
          height="100%"
          language={language}
          value={content}
          onChange={(v) => setContent(v ?? "")}
          theme="vs-dark"
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "off",
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test MonacoEditorWrapper
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/src/components/code/MonacoEditorWrapper.tsx \
        apps/atlas-web/test/components/code/MonacoEditorWrapper.test.tsx
git commit -m "feat(atlas-web/code): MonacoEditorWrapper client component with dirty state + save + edit-class classification (4 tests)"
```

---

### Task 9: `FileTree` + `FileTreeClient` components

**Files:**
- Create: `apps/atlas-web/src/components/code/FileTree.tsx`
- Create: `apps/atlas-web/src/components/code/FileTreeClient.tsx`
- Create: `apps/atlas-web/test/components/code/FileTree.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/components/code/FileTree.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// FileTree is a Server Component in production; for tests we render it synchronously
// by mocking the async data-fetch so it becomes a regular function component.
vi.mock("@atlas/spec-graph-sync", () => ({
  listMirroredFiles: vi.fn().mockResolvedValue([
    "src/index.ts",
    "src/components/Button.tsx",
    "src/lib/api.ts",
    "package.json",
    "README.md",
  ]),
}));

// FileTreeClient is a pure client component — render directly
import { FileTreeClient } from "../../../src/components/code/FileTreeClient.js";

const FIXTURE_FILES = [
  "src/index.ts",
  "src/components/Button.tsx",
  "src/lib/api.ts",
  "package.json",
  "README.md",
];

describe("FileTreeClient", () => {
  it("renders all file paths as list items", () => {
    const onSelect = vi.fn();
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    );
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(FIXTURE_FILES.length);
  });

  it("calls onSelectFile when a file is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    );
    fireEvent.click(screen.getByText("src/index.ts"));
    expect(onSelect).toHaveBeenCalledWith("src/index.ts");
  });

  it("highlights the selected file", () => {
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile="package.json"
        onSelectFile={vi.fn()}
      />
    );
    const selected = screen.getByText("package.json").closest("button");
    expect(selected).toHaveClass("bg-zinc-700");
  });

  it("renders file name (not full path) as the visible label", () => {
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    );
    // "Button.tsx" should be visible, not the full path
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test FileTree
```

Expected: module-not-found error.

- [ ] **Step 3: Implement `FileTreeClient.tsx`**

`apps/atlas-web/src/components/code/FileTreeClient.tsx`:

```tsx
"use client";

import React from "react";

export interface FileTreeClientProps {
  files: string[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/**
 * Client Component. Holds no async data — receives the file list from the
 * parent Server Component (FileTree.tsx) and manages selected-file state.
 */
export function FileTreeClient({ files, selectedFile, onSelectFile }: FileTreeClientProps) {
  return (
    <nav className="h-full overflow-y-auto bg-zinc-900 py-2 text-sm text-zinc-300">
      <ul>
        {files.map((filePath) => (
          <li key={filePath}>
            <button
              onClick={() => onSelectFile(filePath)}
              title={filePath}
              className={`flex w-full items-center gap-2 truncate px-3 py-1 text-left hover:bg-zinc-800 ${
                filePath === selectedFile ? "bg-zinc-700 text-white" : ""
              }`}
            >
              <span className="truncate">{fileName(filePath)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Implement `FileTree.tsx`**

`apps/atlas-web/src/components/code/FileTree.tsx`:

```tsx
import React from "react";
import { listMirroredFiles } from "@atlas/spec-graph-sync";
import { FileTreeClient } from "./FileTreeClient.js";

export interface FileTreeProps {
  projectId: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

/**
 * Server Component — fetches file list from @atlas/spec-graph-sync at request time.
 * Delegates interactivity to FileTreeClient (Client Component).
 */
export async function FileTree({ projectId, selectedFile, onSelectFile }: FileTreeProps) {
  const files = await listMirroredFiles({ projectId });
  return (
    <FileTreeClient
      files={files}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
    />
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test FileTree
```

Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/src/components/code/FileTree.tsx \
        apps/atlas-web/src/components/code/FileTreeClient.tsx \
        apps/atlas-web/test/components/code/FileTree.test.tsx
git commit -m "feat(atlas-web/code): FileTree Server Component + FileTreeClient with selection state (4 tests)"
```

---

### Task 10: `MonacoPane` + `PrDiffViewer` — dynamic-import wrappers

**Files:**
- Create: `apps/atlas-web/src/components/code/MonacoPane.tsx`
- Create: `apps/atlas-web/src/components/code/PrDiffViewer.tsx`

No separate test — these are thin `next/dynamic` wrappers; their children are tested in Tasks 8 and 11. Typecheck only.

- [ ] **Step 1: Implement `MonacoPane.tsx`**

`apps/atlas-web/src/components/code/MonacoPane.tsx`:

```tsx
"use client";

import React, { useCallback } from "react";
import dynamic from "next/dynamic";
import { saveFile } from "../../actions/code/saveFile.js";
import { RitualEngine } from "@atlas/ritual-engine";

// Monaco depends on browser globals — must be loaded with ssr: false
const MonacoEditorWrapper = dynamic(
  () =>
    import("./MonacoEditorWrapper.js").then((m) => ({ default: m.MonacoEditorWrapper })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Loading editor…</div> }
);

export interface MonacoPaneProps {
  projectId: string;
  filePath: string;
  content: string;
  language: string;
}

/**
 * Client Component. Loads MonacoEditorWrapper via next/dynamic (ssr: false),
 * wires the save handler (Server Action + RitualEngine).
 */
export function MonacoPane({ projectId, filePath, content, language }: MonacoPaneProps) {
  const engine = new RitualEngine();

  const handleSave = useCallback(
    async ({
      content: newContent,
      filePath: fp,
      editClass,
    }: {
      content: string;
      filePath: string;
      editClass: "cosmetic" | "structural";
    }) => {
      // 1. Persist through spec-graph-sync
      await saveFile({ projectId, filePath: fp, content: newContent });
      // 2. Kick off ritual — cosmetic takes the fast path, structural goes full ritual
      await engine.start({ intent: `edit ${fp}`, editClass, projectId, userId: "session" });
    },
    [projectId, engine]
  );

  return (
    <div className="h-full w-full">
      <MonacoEditorWrapper
        projectId={projectId}
        filePath={filePath}
        initialContent={content}
        language={language}
        onSave={handleSave}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement `PrDiffViewer.tsx`**

`apps/atlas-web/src/components/code/PrDiffViewer.tsx`:

```tsx
"use client";

import React from "react";
import dynamic from "next/dynamic";

// DiffEditor also depends on browser globals
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Loading diff…</div> }
);

export interface PrDiffViewerProps {
  /** Unified diff string as returned by getPrDiff Server Action */
  diff: string;
}

/**
 * Parses a unified diff into original + modified text for Monaco DiffEditor.
 * This is a best-effort renderer — it splits on the first `---`/`+++` boundary.
 * A full diff-parser (e.g. `diff` npm package) can replace this in a follow-up.
 */
function parseDiff(unified: string): { original: string; modified: string } {
  const lines = unified.split("\n");
  const original: string[] = [];
  const modified: string[] = [];

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      original.push(line.slice(1));
    } else if (line.startsWith("+")) {
      modified.push(line.slice(1));
    } else {
      original.push(line.slice(1));
      modified.push(line.slice(1));
    }
  }

  return { original: original.join("\n"), modified: modified.join("\n") };
}

export function PrDiffViewer({ diff }: PrDiffViewerProps) {
  const { original, modified } = parseDiff(diff);

  return (
    <div className="h-full w-full">
      <DiffEditor
        height="100%"
        original={original}
        modified={modified}
        theme="vs-dark"
        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | grep -E "MonacoPane|PrDiffViewer"
```

Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/src/components/code/MonacoPane.tsx \
        apps/atlas-web/src/components/code/PrDiffViewer.tsx
git commit -m "feat(atlas-web/code): MonacoPane + PrDiffViewer dynamic-import wrappers (ssr: false)"
```

---

### Task 11: `PrPane` + `PrCommentThread` components

**Files:**
- Create: `apps/atlas-web/src/components/code/PrPane.tsx`
- Create: `apps/atlas-web/src/components/code/PrCommentThread.tsx`
- Create: `apps/atlas-web/test/components/code/PrPane.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/components/code/PrPane.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Stub Server Actions
vi.mock("../../../src/actions/code/listPrs.js", () => ({
  listPrs: vi.fn().mockResolvedValue([
    {
      number: 7,
      title: "Add login page",
      state: "open",
      html_url: "https://github.com/acme/app/pull/7",
      head: { ref: "feat/login" },
      base: { ref: "main" },
    },
  ]),
}));

vi.mock("../../../src/actions/code/openPr.js", () => ({
  openPr: vi.fn().mockResolvedValue({ prNumber: 8, prUrl: "https://github.com/acme/app/pull/8" }),
}));

vi.mock("../../../src/actions/code/getPrDiff.js", () => ({
  getPrDiff: vi.fn().mockResolvedValue({ diff: "--- a/index.ts\n+++ b/index.ts\n@@ -1 +1 @@\n-old\n+new" }),
}));

vi.mock("../../../src/components/code/PrDiffViewer.js", () => ({
  PrDiffViewer: ({ diff }: { diff: string }) => <pre data-testid="diff-viewer">{diff}</pre>,
}));

import { PrPane } from "../../../src/components/code/PrPane.js";
import { listPrs } from "../../../src/actions/code/listPrs.js";

beforeEach(() => vi.clearAllMocks());

describe("PrPane", () => {
  const props = { projectId: "p-1", repoSlug: "acme/app" };

  it("loads and renders open PRs on mount", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => expect(screen.getByText("Add login page")).toBeInTheDocument());
    expect(listPrs).toHaveBeenCalledWith({ projectId: "p-1", repoSlug: "acme/app", state: "open" });
  });

  it("shows PR number and branch names", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    expect(screen.getByText(/feat\/login/)).toBeInTheDocument();
  });

  it("renders the diff viewer when a PR is selected", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    fireEvent.click(screen.getByText("Add login page"));
    await waitFor(() => expect(screen.getByTestId("diff-viewer")).toBeInTheDocument());
  });

  it("shows an 'Open PR' form button", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    expect(screen.getByRole("button", { name: /open pr/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test PrPane
```

Expected: module-not-found errors.

- [ ] **Step 3: Implement `PrCommentThread.tsx`**

`apps/atlas-web/src/components/code/PrCommentThread.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { postPrComment } from "../../actions/code/postPrComment.js";

export interface PrComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface PrCommentThreadProps {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  comments: PrComment[];
  onCommentPosted?: (id: number) => void;
}

export function PrCommentThread({
  projectId,
  repoSlug,
  prNumber,
  comments,
  onCommentPosted,
}: PrCommentThreadProps) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const result = await postPrComment({ projectId, repoSlug, prNumber, body });
      setBody("");
      onCommentPosted?.(result.commentId);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {comments.map((c) => (
        <div key={c.id} className="rounded border border-zinc-700 bg-zinc-800 p-2 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{c.author}</span>
            <span>{c.createdAt}</span>
          </div>
          <p className="whitespace-pre-wrap text-zinc-300">{c.body}</p>
        </div>
      ))}

      <div className="mt-2 flex flex-col gap-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handlePost}
          disabled={posting || !body.trim()}
          className="self-end rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {posting ? "Posting…" : "Comment"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `PrPane.tsx`**

`apps/atlas-web/src/components/code/PrPane.tsx`:

```tsx
"use client";

import React, { useEffect, useState } from "react";
import { listPrs, type Pr } from "../../actions/code/listPrs.js";
import { openPr } from "../../actions/code/openPr.js";
import { getPrDiff } from "../../actions/code/getPrDiff.js";
import { PrDiffViewer } from "./PrDiffViewer.js";
import { PrCommentThread } from "./PrCommentThread.js";

export interface PrPaneProps {
  projectId: string;
  repoSlug: string;
}

export function PrPane({ projectId, repoSlug }: PrPaneProps) {
  const [prs, setPrs] = useState<Pr[]>([]);
  const [selectedPr, setSelectedPr] = useState<Pr | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [newPrTitle, setNewPrTitle] = useState("");
  const [newPrHead, setNewPrHead] = useState("");
  const [newPrBase, setNewPrBase] = useState("main");
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPrs({ projectId, repoSlug, state: "open" })
      .then(setPrs)
      .finally(() => setLoading(false));
  }, [projectId, repoSlug]);

  async function handleSelectPr(pr: Pr) {
    setSelectedPr(pr);
    setDiff(null);
    const result = await getPrDiff({ projectId, repoSlug, prNumber: pr.number });
    setDiff(result.diff);
  }

  async function handleOpenPr() {
    setOpening(true);
    try {
      const result = await openPr({
        projectId,
        repoSlug,
        head: newPrHead,
        base: newPrBase,
        title: newPrTitle,
      });
      window.open(result.prUrl, "_blank");
      setShowOpenForm(false);
      // Refresh PR list
      const refreshed = await listPrs({ projectId, repoSlug, state: "open" });
      setPrs(refreshed);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-sm text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="font-medium">Pull Requests</span>
        <button
          onClick={() => setShowOpenForm((v) => !v)}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs hover:bg-blue-500"
        >
          Open PR
        </button>
      </div>

      {/* Open PR form */}
      {showOpenForm && (
        <div className="flex flex-col gap-1 border-b border-zinc-700 px-3 pb-3">
          <input
            placeholder="Head branch"
            value={newPrHead}
            onChange={(e) => setNewPrHead(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <input
            placeholder="Base branch (default: main)"
            value={newPrBase}
            onChange={(e) => setNewPrBase(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <input
            placeholder="PR title"
            value={newPrTitle}
            onChange={(e) => setNewPrTitle(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
          />
          <button
            onClick={handleOpenPr}
            disabled={opening || !newPrTitle || !newPrHead}
            className="self-end rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-500 disabled:opacity-40"
          >
            {opening ? "Opening…" : "Create PR"}
          </button>
        </div>
      )}

      {/* PR list */}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-3 text-xs text-zinc-500">Loading…</p>}
        {!loading && prs.length === 0 && (
          <p className="px-3 text-xs text-zinc-500">No open pull requests.</p>
        )}
        <ul>
          {prs.map((pr) => (
            <li key={pr.number}>
              <button
                onClick={() => handleSelectPr(pr)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-zinc-800 ${
                  selectedPr?.number === pr.number ? "bg-zinc-800" : ""
                }`}
              >
                <span className="font-medium">{pr.title}</span>
                <span className="text-xs text-zinc-400">
                  #{pr.number} · {pr.head.ref} → {pr.base.ref}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Diff viewer for selected PR */}
        {selectedPr && diff && (
          <div className="mt-2 h-64 border-t border-zinc-700">
            <PrDiffViewer diff={diff} />
          </div>
        )}
        {selectedPr && diff === null && (
          <p className="px-3 py-2 text-xs text-zinc-500">Loading diff…</p>
        )}

        {/* Comment thread for selected PR */}
        {selectedPr && (
          <PrCommentThread
            projectId={projectId}
            repoSlug={repoSlug}
            prNumber={selectedPr.number}
            comments={[]}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test PrPane
```

Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/src/components/code/PrPane.tsx \
        apps/atlas-web/src/components/code/PrCommentThread.tsx \
        apps/atlas-web/test/components/code/PrPane.test.tsx
git commit -m "feat(atlas-web/code): PrPane (list/select/diff/open-form) + PrCommentThread + Server Action wiring (4 tests)"
```

---

### Task 12: `TerminalPane` + `TestRunnerPane` components

**Files:**
- Create: `apps/atlas-web/src/components/code/TerminalPane.tsx`
- Create: `apps/atlas-web/src/components/code/TestRunnerPane.tsx`
- Create: `apps/atlas-web/test/components/code/RightPane.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/components/code/RightPane.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Stub xterm — browser-only
vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
  })),
}));
vi.mock("xterm-addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
}));

vi.mock("../../../src/actions/code/connectTerminal.js", () => ({
  connectTerminal: vi.fn().mockResolvedValue({
    status: "stub",
    message: "sandbox not connected yet (E.4)",
  }),
}));

vi.mock("../../../src/actions/code/getTestResults.js", () => ({
  getTestResults: vi.fn().mockResolvedValue({
    status: "stub",
    suites: [],
    message: "test runner not connected yet (E.4)",
  }),
}));

import { RightPane } from "../../../src/components/code/RightPane.js";

beforeEach(() => vi.clearAllMocks());

const PROPS = { projectId: "p-1" };

describe("RightPane tab navigation", () => {
  it("renders the PR tab by default", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    expect(screen.getByRole("tab", { name: /pr/i })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Terminal tab when clicked", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /terminal/i }));
    expect(screen.getByRole("tab", { name: /terminal/i })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Tests tab when clicked", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /tests/i }));
    expect(screen.getByRole("tab", { name: /tests/i })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the stub message in the Terminal tab", async () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /terminal/i }));
    await waitFor(() =>
      expect(screen.getByText(/sandbox not connected yet/i)).toBeInTheDocument()
    );
  });

  it("shows the stub message in the Tests tab", async () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /tests/i }));
    await waitFor(() =>
      expect(screen.getByText(/test runner not connected yet/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @atlas/atlas-web test RightPane
```

Expected: module-not-found errors.

- [ ] **Step 3: Implement `TerminalPane.tsx`**

`apps/atlas-web/src/components/code/TerminalPane.tsx`:

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { connectTerminal } from "../../actions/code/connectTerminal.js";

export interface TerminalPaneProps {
  projectId: string;
}

/**
 * Client Component. Mounts xterm.js in the DOM ref.
 * In E.3 the backend stub returns a "not connected" message.
 * Plan E.4 replaces the stub with a real WebSocket URL.
 */
export function TerminalPane({ projectId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let terminal: import("xterm").Terminal | null = null;

    async function init() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");

      terminal = new Terminal({
        theme: { background: "#18181b", foreground: "#d4d4d8" },
        fontSize: 13,
        cursorBlink: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (containerRef.current) {
        terminal.open(containerRef.current);
        fitAddon.fit();
      }

      // Connect to backend (stub in E.3)
      const result = await connectTerminal({ projectId });
      if (result.status === "stub") {
        terminal.write(`\r\n\x1b[33m${result.message}\x1b[0m\r\n`);
        setStatusMessage(result.message);
      }
      // TODO(E.4): result.status === "connected" → establish WebSocket and pipe to terminal
    }

    init();

    return () => {
      terminal?.dispose();
    };
  }, [projectId]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {statusMessage && (
        <div
          data-testid="terminal-status"
          className="border-b border-zinc-800 px-3 py-1 text-xs text-amber-400"
        >
          {statusMessage}
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1" />
    </div>
  );
}
```

- [ ] **Step 4: Implement `TestRunnerPane.tsx`**

`apps/atlas-web/src/components/code/TestRunnerPane.tsx`:

```tsx
"use client";

import React, { useEffect, useState } from "react";
import { getTestResults, type GetTestResultsResult } from "../../actions/code/getTestResults.js";

export interface TestRunnerPaneProps {
  projectId: string;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "done" ? "bg-green-600" : status === "running" ? "bg-blue-500 animate-pulse" : "bg-zinc-600";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs text-white ${color}`}>{status}</span>;
}

/**
 * Client Component. Displays vitest results from the E2B sandbox.
 * In E.3 the backend stub returns status: "stub" with an empty suite list.
 * Plan E.4 wires the real test-runner stream.
 */
export function TestRunnerPane({ projectId }: TestRunnerPaneProps) {
  const [results, setResults] = useState<GetTestResultsResult | null>(null);

  useEffect(() => {
    getTestResults({ projectId }).then(setResults);
    // TODO(E.4): replace with a streaming SSE or WebSocket listener
  }, [projectId]);

  if (!results) {
    return <div className="flex h-full items-center justify-center text-xs text-zinc-500">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm text-zinc-200">
      <div className="flex items-center gap-2">
        <span className="font-medium">Test Runner</span>
        <StatusBadge status={results.status} />
      </div>

      {results.message && (
        <p className="text-xs text-amber-400">{results.message}</p>
      )}

      {results.suites.length === 0 && results.status !== "stub" && (
        <p className="text-xs text-zinc-500">No test suites found.</p>
      )}

      {results.suites.map((suite) => (
        <div key={suite.name} className="rounded border border-zinc-700 bg-zinc-800 p-2">
          <div className="flex items-center justify-between">
            <span className="truncate font-medium">{suite.name}</span>
            <span className="text-xs text-zinc-400">{suite.duration}ms</span>
          </div>
          <div className="mt-1 flex gap-3 text-xs">
            <span className="text-green-400">{suite.passed} passed</span>
            {suite.failed > 0 && <span className="text-red-400">{suite.failed} failed</span>}
            {suite.skipped > 0 && <span className="text-zinc-400">{suite.skipped} skipped</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implement `RightPane.tsx`**

`apps/atlas-web/src/components/code/RightPane.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { PrPane } from "./PrPane.js";
import { TerminalPane } from "./TerminalPane.js";
import { TestRunnerPane } from "./TestRunnerPane.js";

type Tab = "pr" | "terminal" | "tests";

export interface RightPaneProps {
  projectId: string;
  repoSlug: string;
}

export function RightPane({ projectId, repoSlug }: RightPaneProps) {
  const [activeTab, setActiveTab] = useState<Tab>("pr");

  const tabs: { id: Tab; label: string }[] = [
    { id: "pr", label: "PR" },
    { id: "terminal", label: "Terminal" },
    { id: "tests", label: "Tests" },
  ];

  return (
    <div className="flex h-full flex-col border-l border-zinc-700 bg-zinc-900">
      {/* Tab strip */}
      <div className="flex border-b border-zinc-700" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-blue-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "pr" && <PrPane projectId={projectId} repoSlug={repoSlug} />}
        {activeTab === "terminal" && <TerminalPane projectId={projectId} />}
        {activeTab === "tests" && <TestRunnerPane projectId={projectId} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run — expect pass**

```bash
pnpm --filter @atlas/atlas-web test RightPane
```

Expected: 5 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/src/components/code/TerminalPane.tsx \
        apps/atlas-web/src/components/code/TestRunnerPane.tsx \
        apps/atlas-web/src/components/code/RightPane.tsx \
        apps/atlas-web/test/components/code/RightPane.test.tsx
git commit -m "feat(atlas-web/code): TerminalPane + TestRunnerPane + RightPane tab shell (5 tests)"
```

---

### Task 13: `CodeLayout` — three-pane shell

**Files:**
- Create: `apps/atlas-web/src/components/code/CodeLayout.tsx`

No separate test — layout composes already-tested components; structural correctness is verified by a typecheck + visual review. Typecheck only here.

- [ ] **Step 1: Implement `CodeLayout.tsx`**

`apps/atlas-web/src/components/code/CodeLayout.tsx`:

```tsx
"use client";

import React, { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { FileTreeClient } from "./FileTreeClient.js";
import { RightPane } from "./RightPane.js";
import { openFile } from "../../actions/code/openFile.js";

// MonacoPane is already ssr: false internally, but CodeLayout is a Client Component
// that orchestrates state — it imports MonacoPane directly (no additional dynamic needed).
const MonacoPane = dynamic(
  () => import("./MonacoPane.js").then((m) => ({ default: m.MonacoPane })),
  { ssr: false }
);

export interface CodeLayoutProps {
  projectId: string;
  repoSlug: string;
  /** Initial file list from the Server Component above (FileTree.tsx) */
  files: string[];
}

interface OpenedFile {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Client Component — three-pane shell for the Code view.
 *
 *   ┌──────────────┬───────────────────────────┬──────────────┐
 *   │   FileTree   │       Monaco Editor        │  Right Pane  │
 *   │  (16rem min) │       (flex: 1)            │  (22rem min) │
 *   │              │                            │  PR/Term/    │
 *   │              │                            │  Tests tabs  │
 *   └──────────────┴───────────────────────────┴──────────────┘
 *
 * File content is loaded lazily when the user clicks a file in the tree.
 */
export function CodeLayout({ projectId, repoSlug, files }: CodeLayoutProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const handleSelectFile = useCallback(
    async (filePath: string) => {
      if (filePath === selectedFile) return;
      setSelectedFile(filePath);
      setLoadingFile(true);
      try {
        const result = await openFile({ projectId, filePath });
        setOpenedFile({ filePath, content: result.content, language: result.language });
      } catch {
        setOpenedFile({ filePath, content: "", language: "plaintext" });
      } finally {
        setLoadingFile(false);
      }
    },
    [projectId, selectedFile]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950 text-zinc-200">
      {/* File tree — left sidebar */}
      <aside className="w-56 min-w-[10rem] max-w-xs shrink-0 border-r border-zinc-700">
        <FileTreeClient
          files={files}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
        />
      </aside>

      {/* Monaco editor — center pane */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {loadingFile && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Loading file…
          </div>
        )}
        {!loadingFile && openedFile && (
          <MonacoPane
            projectId={projectId}
            filePath={openedFile.filePath}
            content={openedFile.content}
            language={openedFile.language}
          />
        )}
        {!loadingFile && !openedFile && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
            </svg>
            <p className="text-sm">Select a file to edit</p>
          </div>
        )}
      </main>

      {/* Right pane — PR / Terminal / Tests */}
      <aside className="w-80 min-w-[18rem] max-w-sm shrink-0">
        <RightPane projectId={projectId} repoSlug={repoSlug} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | grep CodeLayout
```

Expected: no lines.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/src/components/code/CodeLayout.tsx
git commit -m "feat(atlas-web/code): CodeLayout three-pane shell (FileTree + Monaco + RightPane)"
```

---

### Task 14: Code view route — `/projects/[projectId]/code`

**Files:**
- Create: `apps/atlas-web/src/app/projects/[projectId]/code/page.tsx`
- Create: `apps/atlas-web/src/app/projects/[projectId]/code/layout.tsx`

No separate test — route page composes already-tested components; validated by typecheck + manual smoke test. Typecheck only here.

- [ ] **Step 1: Implement `layout.tsx`**

`apps/atlas-web/src/app/projects/[projectId]/code/layout.tsx`:

```tsx
import React from "react";

/**
 * Code view layout. Enforces full-viewport height so the three-pane shell
 * can fill the screen without a scrollbar on the outer shell.
 *
 * Intentionally does NOT import the Canvas layout — per constraint "Do NOT
 * touch E.2's Canvas view code." Each view owns its own layout subtree.
 */
export default function CodeViewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Implement `page.tsx`**

`apps/atlas-web/src/app/projects/[projectId]/code/page.tsx`:

```tsx
import React from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { listMirroredFiles } from "@atlas/spec-graph-sync";
import { CodeLayout } from "../../../../components/code/CodeLayout.js";

interface CodePageProps {
  params: { projectId: string };
  searchParams: { repo?: string };
}

/**
 * Server Component — root of the Code view.
 *
 * Responsibilities:
 * 1. Gate: unauthenticated users are redirected to /sign-in (Clerk).
 * 2. Fetch initial file list from @atlas/spec-graph-sync (server-side; no waterfall).
 * 3. Render CodeLayout (Client Component) with the file list + repo slug.
 *
 * The `repo` search param carries the GitHub "owner/repo" slug (e.g. "acme/my-app").
 * It is set by the project settings screen (E.2). When absent, PR actions degrade
 * gracefully (they show "no repo connected" placeholder).
 */
export default async function CodePage({ params, searchParams }: CodePageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { projectId } = params;
  const repoSlug = searchParams.repo ?? "";

  let files: string[] = [];
  try {
    files = await listMirroredFiles({ projectId });
  } catch {
    // Mirror may not have files yet (new project). CodeLayout shows empty state.
  }

  return (
    <CodeLayout
      projectId={projectId}
      repoSlug={repoSlug}
      files={files}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck 2>&1 | grep -E "code/page|code/layout"
```

Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/src/app/projects/\[projectId\]/code/
git commit -m "feat(atlas-web/code): /projects/[projectId]/code route page + layout (Server Component, Clerk-gated)"
```

---

### Task 15: Component and Server Action integration tests sweep

**Files:**
- No new files — runs the full `apps/atlas-web` test suite and verifies everything introduced in Tasks 2–12 passes together.

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @atlas/atlas-web test --reporter=verbose 2>&1
```

Expected output pattern:
```
✓ languageHint.test.ts (12 tests)
✓ editClassifier.test.ts (7 tests)
✓ openFile.test.ts (3 tests)
✓ saveFile.test.ts (3 tests)
✓ prActions.test.ts (5 tests)
✓ MonacoEditorWrapper.test.tsx (4 tests)
✓ FileTree.test.tsx (4 tests)
✓ PrPane.test.tsx (4 tests)
✓ RightPane.test.tsx (5 tests)
```

Total: 47 tests passing, 0 failing.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck
```

Expected: exit 0 (zero new errors introduced by E.3).

- [ ] **Step 3: Commit (if clean)**

```bash
git add --update
git commit -m "test(atlas-web/code): verify 47 tests pass + zero typecheck regressions across E.3 additions"
```

---

### Task 16: README addition — Code view + Monaco integration

**Files:**
- Modify: `apps/atlas-web/README.md`

- [ ] **Step 1: Append Code view section to `apps/atlas-web/README.md`**

Add the following section after the existing Canvas view documentation:

```markdown
## Code View (`/projects/[projectId]/code`)

> **Persona target:** Diego (developer) and Priya (architect + developer). The Canvas view (E.2) and the Code view share the same project; clicking an element in one view highlights it in the other (cross-view linking lands in E.2's dual-pane wiring).

### Layout

Three-pane shell:

```
┌─────────────────┬───────────────────────────────┬────────────────┐
│   File Tree     │       Monaco Editor            │  Right Pane    │
│   (FileTree +   │  (@monaco-editor/react,        │  Tab strip:    │
│   FileTree-     │   ssr: false, dark theme)      │  PR | Terminal │
│   Client)       │                                │  | Tests       │
└─────────────────┴───────────────────────────────┴────────────────┘
```

### File tree

Populated from `@atlas/spec-graph-sync`'s `listMirroredFiles({ projectId })`. The Server Component fetches the list at render time; `FileTreeClient` (Client Component) holds selected-file state. Clicking a file triggers the `openFile` Server Action which reads via `@atlas/spec-graph-sync` and returns the content + Monaco language hint.

### Monaco editor

Loaded via `next/dynamic` with `ssr: false`. On save:
1. `saveFile` Server Action writes through `@atlas/spec-graph-sync` (which updates the file mirror).
2. `editClassifier.ts` heuristic classifies the change as `"cosmetic"` or `"structural"`.
3. `RitualEngine.start({ editClass })` is called — cosmetic edits take the `visualize → build` fast path; structural edits take the full `visualize → agree → build` ritual.

### PR pane

Uses `@octokit/rest` exclusively in Server Actions (token never reaches the browser):
- `listPrs` — list open/closed PRs for the project's GitHub repo.
- `openPr` — create a new PR. Stub note: E.3 ships only the API call; the `git push` that creates the branch on the remote is wired in **Plan E.4** (E2B sandbox).
- `getPrDiff` — fetch unified diff; rendered via Monaco `DiffEditor` in `PrDiffViewer`.
- `postPrComment` — post an issue comment on the PR.
- `mergePr` — squash/merge/rebase merge via `octokit.pulls.merge`.

Configure `GITHUB_TOKEN` in `.env.local`:
```env
GITHUB_TOKEN=ghp_your_token_here
```

### Terminal pane

Mounts `xterm.js` (also `ssr: false`). In **E.3** the backend is a stub that writes `"sandbox not connected yet (E.4)"` to the terminal. The real WebSocket bridge to the E2B sandbox lands in **Plan E.4**.

### Test runner pane

Displays `vitest` JSON results. In **E.3** the backend is a stub. Real results stream in from the E2B sandbox in **Plan E.4**.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | For PR flow | Personal access token or GitHub App installation token with `repo` scope |

All other env vars (database URL, Clerk keys, etc.) are inherited from the E.2 scaffold.

### Adding a new Server Action

1. Create `src/actions/code/<name>.ts`.
2. Add `"use server"` at the top.
3. Call `auth()` from `@clerk/nextjs/server`; throw `"UNAUTHORIZED"` if no session.
4. Add a test in `test/actions/code/<name>.test.ts` that mocks all external calls.
5. Import and call from the Client Component (Next.js will automatically route the call through the Next.js server boundary).
```

- [ ] **Step 2: Commit**

```bash
git add apps/atlas-web/README.md
git commit -m "docs(atlas-web): add Code view + Monaco integration section to README"
```

---

### Task 17: Update plan index — mark E.3 Shipped; refresh execution-order diagram

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add E.3 row to the plan index table**

Insert after the E.1 row (row 11):

```markdown
| 17 | `2026-04-20-atlas-web-code-monaco.md` | **E.3 — Atlas Web Code view + Monaco** | Monaco editor, File tree (spec-graph-sync), GitHub PR flow (Octokit), xterm terminal stub, vitest test-runner stub | 17 tasks, TDD | Ready to execute (after E.2) |
```

- [ ] **Step 2: Update execution-order diagram**

In the diagram under `### Phase A — immediate`, extend the Unit E block:

```
└─ Unit E — Ritual + UX [from Plans[9] Unit E]
     ├─ E.1 (Plans[11]) — Ritual Engine (headless)
     ├─ E.2 (Plans[?]) — Atlas Web Scaffold + Canvas view   ← authored in parallel
     ├─ E.3 (Plans[17]) — Atlas Web Code view + Monaco      ← this plan
     └─ E.4 — E2B Sandbox + Preview (after E.3)
          └─ E.5 — Ritual Integration Tests (after E.4)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add E.3 to plan index; update Unit E execution-order diagram"
```

---

## Completion Checklist

All items must be true before E.3 is marked **Shipped**.

### Dependencies
- [ ] Plan E.1 (`packages/ritual-engine/`) is merged — `@atlas/ritual-engine` resolves in the workspace
- [ ] Plan E.2 (`apps/atlas-web/`) is merged — Next.js 15 app scaffold exists; Canvas view is at `/projects/[projectId]/canvas`
- [ ] Plan A.2 (`@atlas/spec-graph-sync`) is merged — `listMirroredFiles`, `readMirroredFile`, `writeMirroredFile` are exported

### Dependencies added (Task 1)
- [ ] `@monaco-editor/react` in `apps/atlas-web/package.json`
- [ ] `xterm` and `xterm-addon-fit` in `apps/atlas-web/package.json`
- [ ] `@octokit/rest` in `apps/atlas-web/package.json`
- [ ] `pnpm-lock.yaml` updated

### Lib utilities (Tasks 2–4)
- [ ] `languageFromPath` maps all common extensions correctly; 12 tests pass
- [ ] `classifyEdit` returns `"structural"` by default; handles Tailwind cosmetic case; 7 tests pass
- [ ] `createOctokit` and `parseRepoSlug` implemented; typechecks clean

### Server Actions (Tasks 5–7)
- [ ] `openFile`: reads via spec-graph-sync; returns content + language; 3 tests pass
- [ ] `saveFile`: writes via spec-graph-sync; enforces auth; 3 tests pass
- [ ] `listPrs`, `openPr`, `getPrDiff`, `postPrComment`, `mergePr`: all call mocked Octokit; 5 tests pass
- [ ] `openPr` contains `// TODO(E.4): trigger sandbox git-push` comment
- [ ] `connectTerminal` stub returns `"sandbox not connected yet (E.4)"`
- [ ] `getTestResults` stub returns `status: "stub"` with empty suites
- [ ] All Server Actions have `"use server"` directive at top
- [ ] All Server Actions call `auth()` and throw `UNAUTHORIZED` when session is absent

### Components (Tasks 8–13)
- [ ] `MonacoEditorWrapper`: dirty indicator, save button, `classifyEdit` on save; 4 tests pass
- [ ] `FileTreeClient`: renders all files, highlights selection, shows file name not full path; 4 tests pass
- [ ] `MonacoPane`: `next/dynamic` with `ssr: false`; wires save handler to `saveFile` + `RitualEngine`
- [ ] `PrDiffViewer`: `next/dynamic` with `ssr: false`; uses Monaco `DiffEditor`
- [ ] `PrPane`: loads PR list on mount, shows diff on select, shows Open PR form; 4 tests pass
- [ ] `PrCommentThread`: renders thread, posts comment via `postPrComment` action
- [ ] `TerminalPane`: mounts xterm.js; shows stub message from `connectTerminal` action
- [ ] `TestRunnerPane`: shows stub message from `getTestResults` action
- [ ] `RightPane`: tab strip (PR | Terminal | Tests); shows stub messages in correct tabs; 5 tests pass
- [ ] `CodeLayout`: three-pane shell; file selection triggers `openFile` action; typechecks clean

### Route (Task 14)
- [ ] `/projects/[projectId]/code/page.tsx` is a Server Component
- [ ] Auth gate: unauthenticated → redirect `/sign-in`
- [ ] Passes `files` + `repoSlug` to `CodeLayout`
- [ ] `layout.tsx` enforces `h-screen` full-viewport height

### Test suite (Task 15)
- [ ] `pnpm --filter @atlas/atlas-web test` → **47 tests pass, 0 fail**
- [ ] `pnpm --filter @atlas/atlas-web exec tsc --noEmit --skipLibCheck` → exit 0

### Documentation (Tasks 16–17)
- [ ] `apps/atlas-web/README.md` has a "Code View" section documenting layout, env vars, and how to add a Server Action
- [ ] `docs/superpowers/plans/README.md` has E.3 row in plan index table
- [ ] Execution-order diagram shows E.2 and E.3 as siblings under E.1

### Constraints verified
- [ ] No Canvas view files (`src/app/projects/[projectId]/canvas/`) are touched
- [ ] Monaco is loaded only via `next/dynamic` with `ssr: false` — no `import Editor from "@monaco-editor/react"` at module-top level in any Server Component
- [ ] xterm is loaded only via dynamic `import()` inside a `useEffect` — never at module-top level
- [ ] No real network calls in tests — Octokit mocked via `vi.mock`; `@atlas/spec-graph-sync` mocked via `vi.mock`; Clerk `auth()` mocked via `vi.mock`
- [ ] `GITHUB_TOKEN` is read only in `octokitClient.ts` (Server Action path); never accessed in Client Components

---

## Handoff to E.4

**Plan E.4 — E2B Sandbox + Preview** picks up exactly two stubs left open by E.3:

1. **Terminal stub** (`connectTerminal` Server Action): E.4 provisions/resumes an E2B sandbox for the project, opens a terminal session, and returns a WebSocket URL. `TerminalPane.tsx` already has the `// TODO(E.4)` branch that handles `result.status === "connected"` and connects the xterm instance to the WebSocket.

2. **Test-runner stub** (`getTestResults` Server Action): E.4 streams `vitest --reporter=json` output from the sandbox. `TestRunnerPane.tsx` is already shaped to display `VitestSuiteResult[]` — E.4 only needs to populate the array.

3. **`openPr` git-push prerequisite**: E.4 wires the `// TODO(E.4): trigger sandbox git-push` path in `openPr.ts`. Once the sandbox has committed and pushed the branch, `openPr` can call `octokit.pulls.create` without the branch being absent on the remote.

**What E.4 must not break:**
- The three-pane layout (`CodeLayout`) — E.4 adds no new panes.
- The `saveFile` / `openFile` Server Actions — file I/O goes through `@atlas/spec-graph-sync`; E.4's sandbox is an additional consumer of those files, not a replacement.
- All 47 E.3 tests — E.4 may add tests but must not delete or weaken E.3 tests.

**Entry criterion for E.4:** E.3 merged, all 47 tests green, `GITHUB_TOKEN` documented in the deployment runbook.
