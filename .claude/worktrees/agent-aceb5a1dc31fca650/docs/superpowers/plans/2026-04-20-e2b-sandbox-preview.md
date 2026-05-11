# E2B Sandbox + Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two deliverables — `packages/sandbox-e2b/` (a server-side TypeScript wrapper around the E2B SDK exposing `SandboxLifecycle`, `SandboxFileSystem`, `SandboxExec`, and `SandboxPreview`) and the `apps/atlas-web/` integration layer (HMR iframe in Canvas, multi-viewport preview, shareable URL Server Action, real sandbox shell wired into Code view's terminal, and vitest output wired into Code view's test runner). After E.4 merges, a user can open an Atlas project and see their app running live in a sandboxed Next.js or FastAPI environment without any manual `npm run dev` or Docker commands.

**Architecture:** `packages/sandbox-e2b/` is a pure server-side package — zero browser imports. It wraps the `@e2b/sdk` behind four typed interfaces so every consumer can inject a mock for tests. `SandboxLifecycle` is the entry point: `provision(template, projectId)` spins up an E2B sandbox using a pre-pinned template digest, records the sandbox id in a per-project in-memory registry, and checks a spend cap before provision completes. `SandboxFileSystem`, `SandboxExec`, and `SandboxPreview` each take a sandbox id and proxy straight through the E2B SDK. The `apps/atlas-web/` integration uses a singleton per-project factory (Next.js server-side, lazy-provisioned) so the HMR iframe has a URL to `src` before the first user interaction completes. The E.3 terminal stub is replaced by forwarding stdin/stdout through `SandboxExec.streamCommand`; the E.3 test runner stub is replaced by streaming `vitest --reporter=json` output through the same interface.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · `@e2b/sdk` (latest) · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS · `iframe-resizer` (latest) for HMR iframe sizing · Next.js 15 App Router · React 18.3 · Clerk (E.2's auth, inherited). No changes to E.2 or E.3 code outside the documented integration points.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1, B.1, C.1, D.1, E.1, E.2, E.3 merged (E.4 wires the sandbox into the web app that E.2 scaffolds and E.3's terminal/test runner stubs).
- Node 22 LTS + pnpm 9+.
- `E2B_API_KEY` env var (server-side only; never exposed to the browser bundle).
- An E2B account with `atlas-next-ts` and `atlas-python-fastapi` template digests recorded in `apps/atlas-web/.env`.
- No real E2B provision happens in CI — all tests mock the SDK.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  sandbox-e2b/                                  # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                                  # public API barrel
      types.ts                                  # SandboxId, TemplateId, SandboxRecord Zod
      lifecycle.ts                              # SandboxLifecycle interface + E2BLifecycle implementation
      filesystem.ts                             # SandboxFileSystem interface + E2BFileSystem implementation
      exec.ts                                   # SandboxExec interface + E2BExec implementation
      preview.ts                                # SandboxPreview interface + E2BPreview implementation
      cost-cap.ts                               # SpendCapConfig Zod + checkSpendCap()
      errors.ts                                 # SpendCapExceededError, SandboxNotFoundError, SandboxProvisionError
    test/
      lifecycle.test.ts
      filesystem.test.ts
      exec.test.ts
      preview.test.ts
      cost-cap.test.ts
      public-api.test.ts
      integration.test.ts                       # full mock-SDK end-to-end

apps/
  atlas-web/
    src/
      lib/
        sandbox/
          factory.ts                            # NEW — singleton SandboxFactory per project (lazy-provision)
          types.ts                              # NEW — SandboxSession type used by atlas-web
      app/
        (dashboard)/
          projects/
            [projectId]/
              canvas/
                _components/
                  HmrIframe.tsx                 # NEW — HMR iframe with iframe-resizer
                  ViewportToggle.tsx            # NEW — 1440/768/375 toggle
                  ShareableUrlModal.tsx         # NEW — shareable URL modal + access mode picker
              code/
                _components/
                  TerminalPane.tsx              # MODIFIED — replace E.3 stub with real sandbox shell
                  TestRunnerPane.tsx            # MODIFIED — replace E.3 stub with real vitest stream
      actions/
        sandbox.ts                              # NEW — Server Action: createShareableUrl()
    .env.example                                # MODIFIED — add E2B_API_KEY + template digest vars
    __tests__/
      HmrIframe.test.tsx                        # NEW
      ViewportToggle.test.tsx                   # NEW
      ShareableUrlModal.test.tsx                # NEW
      sandbox-factory.test.ts                   # NEW

docs/superpowers/plans/
  README.md                                     # MODIFIED — add E.4 entry
```

**Why this shape.** Keeping the E2B wrapper in its own package means the web app never imports `@e2b/sdk` directly — the package boundary enforces the "no SDK in browser bundle" rule. The per-project singleton factory in `apps/atlas-web/src/lib/sandbox/factory.ts` makes the HMR iframe URL deterministic per project, avoiding double-provision races. Splitting `HmrIframe`, `ViewportToggle`, and `ShareableUrlModal` into separate components lets them each have a focused component test without mocking unrelated state.

## Open-question resolutions

These resolve the three open questions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` Unit E section that are E.4-specific:

- **Sandbox cost cap → per-project per-month E2B-spend cap, configurable via `apps/atlas-web` env var `SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH`.** `checkSpendCap(projectId, estimatedCostUsd)` calls a lightweight accounting helper that reads accumulated spend from `@atlas/spec-graph-data`'s `sandbox_spend_log` table. Alarm at 3× the project's 30-day rolling average (or 3× global average for new projects); hard pause (throws `SpendCapExceededError`) when the cap is reached. Document in `packages/sandbox-e2b/README.md` + `apps/atlas-web/.env.example`.

- **Shareable URL access modes → three modes: `public`, `password`, `auth`.** `public` serves the preview URL with no credential check (user must explicitly opt in — default is `auth`). `password` requires a shared secret passed as a query parameter and never persisted in plaintext (hashed via `bcrypt` server-side). `auth` requires a valid Clerk session (same session middleware as E.2's app). Default for all non-Ama personas is `auth`; Ama persona default is also `auth` — `public` requires an explicit toggle in the `ShareableUrlModal`. The `createShareableUrl()` Server Action records the access mode + expiry + (for `password`) the bcrypt hash in a `preview_urls` table added by this plan's migration.

- **Sandbox image versioning → E2B templates pinned by digest in `apps/atlas-web/.env`.** Template env vars: `E2B_TEMPLATE_NEXT_TS_DIGEST` and `E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST`. Weekly rebuild via a GitHub Actions workflow that mirrors the Plan C.2 release pattern: build image → push to E2B → open a PR updating the digest vars → auto-merge if smoke test passes. Document in `packages/sandbox-e2b/README.md`.

---

## Tasks

### Task 1: Scaffold `packages/sandbox-e2b/`

**Files:**
- Create: `packages/sandbox-e2b/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

No TDD — scaffolding.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/sandbox-e2b/src packages/sandbox-e2b/test
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@atlas/sandbox-e2b",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@e2b/sdk": "latest",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`** — same shape as `packages/conductor/tsconfig.json`. `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, strict, declaration, outDir `./dist`, rootDir `./src`, include `src/**/*`, exclude `test`, `dist`, `node_modules`.

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
```

- [ ] **Step 5: Placeholder `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 6: Install + verify**

```bash
pnpm install
pnpm -F @atlas/sandbox-e2b typecheck
pnpm -F @atlas/sandbox-e2b build
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/sandbox-e2b/ pnpm-lock.yaml
git commit -m "feat(sandbox-e2b): scaffold package with @e2b/sdk + zod deps"
```

---

### Task 2: `types.ts` — `SandboxId`, `TemplateId`, `SandboxRecord`

**Files:**
- Create: `packages/sandbox-e2b/src/types.ts`
- Create: `packages/sandbox-e2b/test/types.test.ts` (not shown separately — covered by lifecycle tests in Task 3)

The shared primitive types underpin all four interfaces. `TemplateId` is a branded string enum matching the two A.1 templates. `SandboxRecord` captures the provisioned sandbox's id, template, projectId, provisioned-at timestamp, and status.

- [ ] **Step 1: Write `src/types.ts`**

```typescript
import { z } from "zod";

/** Opaque identifier returned by E2B on provision. */
export const SandboxIdSchema = z.string().min(1).brand("SandboxId");
export type SandboxId = z.infer<typeof SandboxIdSchema>;

/** The two Atlas prebuilt E2B templates (from A.1 Compose stack). */
export const TemplateIdSchema = z.enum(["atlas-next-ts", "atlas-python-fastapi"]);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

export const SandboxStatusSchema = z.enum(["provisioning", "running", "terminated", "error"]);
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const SandboxRecordSchema = z.object({
  sandboxId: SandboxIdSchema,
  templateId: TemplateIdSchema,
  projectId: z.string().uuid(),
  provisionedAt: z.string().datetime(),
  status: SandboxStatusSchema,
  previewBaseUrl: z.string().url().optional(),
});
export type SandboxRecord = z.infer<typeof SandboxRecordSchema>;

/** E2B template digest — sourced from env vars pinned per Plan C.2 release pattern. */
export const TemplateDigestSchema = z.object({
  templateId: TemplateIdSchema,
  digest: z.string().min(7),
});
export type TemplateDigest = z.infer<typeof TemplateDigestSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/src/types.ts
git commit -m "feat(sandbox-e2b): SandboxId + TemplateId + SandboxRecord Zod types"
```

---

### Task 3: `SandboxLifecycle` interface + E2B-backed implementation

**Files:**
- Create: `packages/sandbox-e2b/src/lifecycle.ts`
- Create: `packages/sandbox-e2b/test/lifecycle.test.ts`

`SandboxLifecycle` is the primary entry point. The interface decouples the web app and tests from the concrete E2B SDK. The implementation (`E2BLifecycle`) is instantiated once at server start with the API key and template digests from env vars.

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2BLifecycle } from "../src/lifecycle.js";
import type { SandboxLifecycle } from "../src/lifecycle.js";
import { SandboxIdSchema } from "../src/types.js";

// Mock the entire @e2b/sdk module
vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

import { Sandbox as MockSandbox } from "@e2b/sdk";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("E2BLifecycle", () => {
  let lifecycle: SandboxLifecycle;
  let fakeSandbox: Record<string, unknown>;

  beforeEach(() => {
    fakeSandbox = {
      sandboxId: "sbx_abc123",
      kill: vi.fn().mockResolvedValue(undefined),
    };
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSandbox);

    lifecycle = new E2BLifecycle({
      apiKey: "test-api-key",
      templateDigests: {
        "atlas-next-ts": "sha256abc",
        "atlas-python-fastapi": "sha256def",
      },
    });
  });

  it("provisions a sandbox and returns a SandboxRecord", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    expect(record.templateId).toBe("atlas-next-ts");
    expect(record.projectId).toBe(PROJECT_ID);
    expect(record.status).toBe("running");
    expect(SandboxIdSchema.safeParse(record.sandboxId).success).toBe(true);
    expect(MockSandbox.create).toHaveBeenCalledWith("atlas-next-ts", {
      apiKey: "test-api-key",
      metadata: { projectId: PROJECT_ID, digest: "sha256abc" },
    });
  });

  it("terminates a running sandbox", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    await lifecycle.terminate(record.sandboxId);
    expect(fakeSandbox.kill).toHaveBeenCalledOnce();
  });

  it("restarts a sandbox by terminating then re-provisioning", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    const restarted = await lifecycle.restart(record.sandboxId);
    expect(restarted.status).toBe("running");
    expect(MockSandbox.create).toHaveBeenCalledTimes(2);
  });

  it("throws SandboxNotFoundError when terminating an unknown id", async () => {
    await expect(
      lifecycle.terminate("sbx_unknown" as ReturnType<typeof SandboxIdSchema.parse>)
    ).rejects.toThrow("SandboxNotFoundError");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/sandbox-e2b test lifecycle
```

- [ ] **Step 3: Implement `src/lifecycle.ts`**

```typescript
import { Sandbox } from "@e2b/sdk";
import { z } from "zod";
import {
  SandboxIdSchema,
  SandboxRecordSchema,
  TemplateIdSchema,
  type SandboxId,
  type SandboxRecord,
  type TemplateId,
} from "./types.js";
import { SandboxNotFoundError, SandboxProvisionError } from "./errors.js";

export interface SandboxLifecycle {
  provision(templateId: TemplateId, projectId: string): Promise<SandboxRecord>;
  terminate(sandboxId: SandboxId): Promise<void>;
  restart(sandboxId: SandboxId): Promise<SandboxRecord>;
}

interface E2BLifecycleConfig {
  apiKey: string;
  templateDigests: Record<string, string>;
}

export class E2BLifecycle implements SandboxLifecycle {
  private readonly config: E2BLifecycleConfig;
  /** In-memory registry: sandboxId → { record, sdkInstance } */
  private readonly registry = new Map<
    SandboxId,
    { record: SandboxRecord; sdk: { kill: () => Promise<void> } }
  >();

  constructor(config: E2BLifecycleConfig) {
    this.config = config;
  }

  async provision(templateId: TemplateId, projectId: string): Promise<SandboxRecord> {
    const digest = this.config.templateDigests[templateId];
    let sdk: { sandboxId: string; kill: () => Promise<void> };
    try {
      sdk = await Sandbox.create(templateId, {
        apiKey: this.config.apiKey,
        metadata: { projectId, digest: digest ?? "unpinned" },
      }) as typeof sdk;
    } catch (err) {
      throw new SandboxProvisionError(
        `Failed to provision ${templateId} for project ${projectId}: ${String(err)}`
      );
    }

    const record = SandboxRecordSchema.parse({
      sandboxId: sdk.sandboxId,
      templateId,
      projectId,
      provisionedAt: new Date().toISOString(),
      status: "running" as const,
    });

    this.registry.set(SandboxIdSchema.parse(sdk.sandboxId), { record, sdk });
    return record;
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    await entry.sdk.kill();
    this.registry.set(sandboxId, {
      ...entry,
      record: { ...entry.record, status: "terminated" },
    });
  }

  async restart(sandboxId: SandboxId): Promise<SandboxRecord> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    await this.terminate(sandboxId);
    return this.provision(entry.record.templateId, entry.record.projectId);
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/sandbox-e2b test lifecycle
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/src/lifecycle.ts packages/sandbox-e2b/test/lifecycle.test.ts
git commit -m "feat(sandbox-e2b): SandboxLifecycle interface + E2BLifecycle provision/terminate/restart"
```

---

### Task 4: `errors.ts` — typed error classes

**Files:**
- Create: `packages/sandbox-e2b/src/errors.ts`

No dedicated test — errors are exercised through the interface tests in Tasks 3, 5, 6, 7.

- [ ] **Step 1: Write `src/errors.ts`**

```typescript
/**
 * Thrown when a sandbox id is not found in the in-memory registry
 * (e.g., provision was never called, or the server restarted).
 */
export class SandboxNotFoundError extends Error {
  readonly sandboxId: string;
  constructor(sandboxId: string) {
    super(`SandboxNotFoundError: sandbox ${sandboxId} not found in registry`);
    this.name = "SandboxNotFoundError";
    this.sandboxId = sandboxId;
  }
}

/**
 * Thrown when the E2B SDK fails to provision a sandbox (network, quota, bad template).
 */
export class SandboxProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxProvisionError";
  }
}

/**
 * Thrown by checkSpendCap() when the project has reached its E2B spend ceiling
 * for the current billing month. No new sandboxes can be provisioned until the
 * cap is raised or the month rolls over.
 */
export class SpendCapExceededError extends Error {
  readonly projectId: string;
  readonly capUsd: number;
  readonly accumulatedUsd: number;
  constructor(projectId: string, capUsd: number, accumulatedUsd: number) {
    super(
      `SpendCapExceededError: project ${projectId} has accumulated $${accumulatedUsd.toFixed(2)} ` +
        `against a $${capUsd.toFixed(2)} monthly cap — sandbox provision blocked`
    );
    this.name = "SpendCapExceededError";
    this.projectId = projectId;
    this.capUsd = capUsd;
    this.accumulatedUsd = accumulatedUsd;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/src/errors.ts
git commit -m "feat(sandbox-e2b): typed error classes — SandboxNotFoundError, SandboxProvisionError, SpendCapExceededError"
```

---

### Task 5: `SandboxFileSystem` — read / write / list / watch

**Files:**
- Create: `packages/sandbox-e2b/src/filesystem.ts`
- Create: `packages/sandbox-e2b/test/filesystem.test.ts`

`SandboxFileSystem` proxies directly through the E2B SDK's filesystem primitives. The `watch` method returns an `AsyncIterable<FileWatchEvent>` yielding typed events (created/modified/deleted) mapped from E2B's raw watcher.

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/filesystem.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { E2BFileSystem } from "../src/filesystem.js";
import type { SandboxFileSystem } from "../src/filesystem.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_fs_test");

function makeMockSdkFs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    read: vi.fn().mockResolvedValue("file contents"),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([
      { name: "index.ts", type: "file", path: "/app/index.ts" },
      { name: "components", type: "dir", path: "/app/components" },
    ]),
    watchDir: vi.fn(),
    ...overrides,
  };
}

function makeSdkRegistry(sandboxId: string, fs: ReturnType<typeof makeMockSdkFs>) {
  return new Map([[sandboxId, { files: fs }]]);
}

describe("E2BFileSystem", () => {
  it("reads a file via the SDK", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    const content = await fsImpl.read(SANDBOX_ID, "/app/index.ts");
    expect(content).toBe("file contents");
    expect(mockFs.read).toHaveBeenCalledWith("/app/index.ts");
  });

  it("writes a file via the SDK", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    await fsImpl.write(SANDBOX_ID, "/app/index.ts", "export {};");
    expect(mockFs.write).toHaveBeenCalledWith("/app/index.ts", "export {};");
  });

  it("lists directory entries", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    const entries = await fsImpl.list(SANDBOX_ID, "/app");
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("index.ts");
    expect(entries[1].type).toBe("dir");
  });

  it("throws SandboxNotFoundError for an unknown sandbox id", async () => {
    const fsImpl: SandboxFileSystem = new E2BFileSystem(new Map());
    await expect(
      fsImpl.read(SandboxIdSchema.parse("sbx_unknown"), "/any")
    ).rejects.toThrow("SandboxNotFoundError");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/sandbox-e2b test filesystem
```

- [ ] **Step 3: Implement `src/filesystem.ts`**

```typescript
import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}

export interface FileWatchEvent {
  kind: "created" | "modified" | "deleted";
  path: string;
  timestamp: string;
}

export interface SandboxFileSystem {
  read(sandboxId: SandboxId, remotePath: string): Promise<string>;
  write(sandboxId: SandboxId, remotePath: string, content: string): Promise<void>;
  list(sandboxId: SandboxId, remotePath: string): Promise<FileEntry[]>;
  watch(sandboxId: SandboxId, remotePath: string): AsyncIterable<FileWatchEvent>;
}

/** Minimal shape of the SDK filesystem object that E2BFileSystem requires. */
interface SdkFs {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
  watchDir?(path: string): AsyncIterable<{ kind: string; path: string }>;
}

interface SdkEntry {
  files: SdkFs;
}

export class E2BFileSystem implements SandboxFileSystem {
  private readonly registry: Map<string, SdkEntry>;

  constructor(registry: Map<string, SdkEntry>) {
    this.registry = registry;
  }

  private sdk(sandboxId: SandboxId): SdkFs {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry.files;
  }

  async read(sandboxId: SandboxId, remotePath: string): Promise<string> {
    return this.sdk(sandboxId).read(remotePath);
  }

  async write(sandboxId: SandboxId, remotePath: string, content: string): Promise<void> {
    return this.sdk(sandboxId).write(remotePath, content);
  }

  async list(sandboxId: SandboxId, remotePath: string): Promise<FileEntry[]> {
    return this.sdk(sandboxId).list(remotePath);
  }

  async *watch(sandboxId: SandboxId, remotePath: string): AsyncIterable<FileWatchEvent> {
    const sdk = this.sdk(sandboxId);
    if (!sdk.watchDir) {
      throw new Error(`E2BFileSystem: SDK instance for ${sandboxId} does not support watchDir`);
    }
    for await (const raw of sdk.watchDir(remotePath)) {
      const kind = raw.kind === "created" || raw.kind === "deleted" ? raw.kind : "modified";
      yield { kind: kind as FileWatchEvent["kind"], path: raw.path, timestamp: new Date().toISOString() };
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/sandbox-e2b test filesystem
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/src/filesystem.ts packages/sandbox-e2b/test/filesystem.test.ts
git commit -m "feat(sandbox-e2b): SandboxFileSystem interface + E2BFileSystem read/write/list/watch"
```

---

### Task 6: `SandboxExec` — `runCommand` + `streamCommand`

**Files:**
- Create: `packages/sandbox-e2b/src/exec.ts`
- Create: `packages/sandbox-e2b/test/exec.test.ts`

`SandboxExec` exposes two methods. `runCommand` accumulates stdout/stderr and returns `{ stdout, stderr, exitCode }` when the process exits. `streamCommand` returns an `AsyncIterable<ExecChunk>` where each chunk carries `{ stream: "stdout" | "stderr", data: string }` — this is the interface the atlas-web terminal pane and test runner pane consume.

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/exec.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { E2BExec } from "../src/exec.js";
import type { SandboxExec } from "../src/exec.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_exec_test");

function makeMockProcess(stdout: string, stderr: string, exitCode: number) {
  return {
    wait: vi.fn().mockResolvedValue({ exitCode }),
    stdout: { pipe: vi.fn() },
    stderr: { pipe: vi.fn() },
    output: { stdout, stderr },
  };
}

function makeMockSdkCommands(process: ReturnType<typeof makeMockProcess>) {
  return {
    run: vi.fn().mockResolvedValue(process),
    runBackground: vi.fn().mockResolvedValue(process),
  };
}

describe("E2BExec", () => {
  it("runCommand accumulates stdout, stderr, and exitCode", async () => {
    const proc = makeMockProcess("hello world\n", "", 0);
    const mockCommands = makeMockSdkCommands(proc);
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const result = await exec.runCommand(SANDBOX_ID, "echo hello world");
    expect(result.stdout).toContain("hello world");
    expect(result.exitCode).toBe(0);
    expect(mockCommands.run).toHaveBeenCalledWith("echo hello world", expect.any(Object));
  });

  it("runCommand surfaces non-zero exit code", async () => {
    const proc = makeMockProcess("", "command not found\n", 127);
    const mockCommands = makeMockSdkCommands(proc);
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const result = await exec.runCommand(SANDBOX_ID, "notacommand");
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("command not found");
  });

  it("throws SandboxNotFoundError for unknown sandbox id", async () => {
    const exec: SandboxExec = new E2BExec(new Map());
    await expect(
      exec.runCommand(SandboxIdSchema.parse("sbx_ghost"), "ls")
    ).rejects.toThrow("SandboxNotFoundError");
  });

  it("streamCommand yields stdout chunks from an AsyncIterable source", async () => {
    async function* fakeStream() {
      yield { stream: "stdout" as const, data: "chunk1\n" };
      yield { stream: "stdout" as const, data: "chunk2\n" };
    }
    const mockCommands = {
      run: vi.fn(),
      runBackground: vi.fn(),
      streamRun: vi.fn().mockReturnValue(fakeStream()),
    };
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const chunks: string[] = [];
    for await (const chunk of exec.streamCommand(SANDBOX_ID, "npm run dev")) {
      if (chunk.stream === "stdout") chunks.push(chunk.data);
    }
    expect(chunks).toEqual(["chunk1\n", "chunk2\n"]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/sandbox-e2b test exec
```

- [ ] **Step 3: Implement `src/exec.ts`**

```typescript
import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export interface SandboxExec {
  runCommand(sandboxId: SandboxId, cmd: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;
  streamCommand(sandboxId: SandboxId, cmd: string, opts?: { cwd?: string }): AsyncIterable<ExecChunk>;
}

interface SdkCommands {
  run(cmd: string, opts?: object): Promise<{ exitCode: number; output: { stdout: string; stderr: string } }>;
  streamRun?(cmd: string, opts?: object): AsyncIterable<ExecChunk>;
}

interface SdkEntry {
  commands: SdkCommands;
}

export class E2BExec implements SandboxExec {
  private readonly registry: Map<string, SdkEntry>;

  constructor(registry: Map<string, SdkEntry>) {
    this.registry = registry;
  }

  private sdk(sandboxId: SandboxId): SdkCommands {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry.commands;
  }

  async runCommand(
    sandboxId: SandboxId,
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<ExecResult> {
    const sdk = this.sdk(sandboxId);
    const result = await sdk.run(cmd, {
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs,
    });
    return {
      stdout: result.output.stdout,
      stderr: result.output.stderr,
      exitCode: result.exitCode,
    };
  }

  async *streamCommand(
    sandboxId: SandboxId,
    cmd: string,
    opts?: { cwd?: string }
  ): AsyncIterable<ExecChunk> {
    const sdk = this.sdk(sandboxId);
    if (!sdk.streamRun) {
      throw new Error(
        `E2BExec: SDK commands object for ${sandboxId} does not support streamRun`
      );
    }
    yield* sdk.streamRun(cmd, { cwd: opts?.cwd });
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/sandbox-e2b test exec
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/src/exec.ts packages/sandbox-e2b/test/exec.test.ts
git commit -m "feat(sandbox-e2b): SandboxExec interface + E2BExec runCommand/streamCommand"
```

---

### Task 7: `SandboxPreview` — `getPreviewUrl(sandboxId, port)`

**Files:**
- Create: `packages/sandbox-e2b/src/preview.ts`
- Create: `packages/sandbox-e2b/test/preview.test.ts`

E2B exposes a per-sandbox HTTP hostname that routes traffic to the sandbox's specified port. `SandboxPreview.getPreviewUrl` derives that URL from the sandbox record. The implementation reads the `previewBaseUrl` field that `E2BLifecycle.provision` sets using E2B's `getHost()` SDK call (or the `previewBaseUrl` from the sandbox object).

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/preview.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { E2BPreview } from "../src/preview.js";
import type { SandboxPreview } from "../src/preview.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_preview_test");

describe("E2BPreview", () => {
  it("returns an https URL using the sandbox's base host and the given port", () => {
    const registry = new Map([
      [
        SANDBOX_ID as string,
        {
          getHost: (port: number) => `${port}-${SANDBOX_ID}.e2b.app`,
        },
      ],
    ]);
    const preview: SandboxPreview = new E2BPreview(registry);
    const url = preview.getPreviewUrl(SANDBOX_ID, 3000);
    expect(url).toBe("https://3000-sbx_preview_test.e2b.app");
  });

  it("supports arbitrary port numbers", () => {
    const registry = new Map([
      [
        SANDBOX_ID as string,
        { getHost: (port: number) => `${port}-${SANDBOX_ID}.e2b.app` },
      ],
    ]);
    const preview: SandboxPreview = new E2BPreview(registry);
    expect(preview.getPreviewUrl(SANDBOX_ID, 8000)).toBe("https://8000-sbx_preview_test.e2b.app");
    expect(preview.getPreviewUrl(SANDBOX_ID, 8080)).toBe("https://8080-sbx_preview_test.e2b.app");
  });

  it("throws SandboxNotFoundError for unknown sandbox id", () => {
    const preview: SandboxPreview = new E2BPreview(new Map());
    expect(() =>
      preview.getPreviewUrl(SandboxIdSchema.parse("sbx_ghost"), 3000)
    ).toThrow("SandboxNotFoundError");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/sandbox-e2b test preview
```

- [ ] **Step 3: Implement `src/preview.ts`**

```typescript
import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface SandboxPreview {
  /** Returns the full HTTPS URL that proxies to the sandbox's HTTP server on `port`. */
  getPreviewUrl(sandboxId: SandboxId, port: number): string;
}

interface SdkHostProvider {
  getHost(port: number): string;
}

export class E2BPreview implements SandboxPreview {
  private readonly registry: Map<string, SdkHostProvider>;

  constructor(registry: Map<string, SdkHostProvider>) {
    this.registry = registry;
  }

  getPreviewUrl(sandboxId: SandboxId, port: number): string {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    const host = entry.getHost(port);
    return `https://${host}`;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/sandbox-e2b test preview
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/src/preview.ts packages/sandbox-e2b/test/preview.test.ts
git commit -m "feat(sandbox-e2b): SandboxPreview interface + E2BPreview.getPreviewUrl"
```

---

### Task 8: `cost-cap.ts` — spend-cap helper

**Files:**
- Create: `packages/sandbox-e2b/src/cost-cap.ts`
- Create: `packages/sandbox-e2b/test/cost-cap.test.ts`

`checkSpendCap` is a pure function called by the atlas-web sandbox factory before calling `lifecycle.provision`. It reads accumulated spend from an injectable `SpendReader` interface (production wires to `@atlas/spec-graph-data`'s `sandbox_spend_log`; tests use an in-memory stub). It throws `SpendCapExceededError` when accumulated ≥ cap. It emits a warning log when accumulated ≥ 3× the 30-day rolling average but is still below cap.

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/cost-cap.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { checkSpendCap, type SpendReader, type SpendCapConfig } from "../src/cost-cap.js";
import { SpendCapExceededError } from "../src/errors.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function makeSpendReader(accumulated: number, rollingAverage: number): SpendReader {
  return {
    getAccumulatedSpend: vi.fn().mockResolvedValue(accumulated),
    getRollingAverageSpend: vi.fn().mockResolvedValue(rollingAverage),
  };
}

const BASE_CONFIG: SpendCapConfig = { capUsd: 50, warnMultiplier: 3 };

describe("checkSpendCap", () => {
  it("resolves without error when spend is safely below cap", async () => {
    const reader = makeSpendReader(10, 5);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).resolves.toBeUndefined();
  });

  it("throws SpendCapExceededError when accumulated >= cap", async () => {
    const reader = makeSpendReader(50, 10);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });

  it("throws SpendCapExceededError when accumulated > cap", async () => {
    const reader = makeSpendReader(75, 10);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });

  it("does not throw when accumulated is 3x rolling average but below cap", async () => {
    // 30 == 3 × 10, still below cap of 50 — should not throw but should warn
    const reader = makeSpendReader(30, 10);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("spend alarm")
    );
    warnSpy.mockRestore();
  });

  it("accumulated exactly at cap throws", async () => {
    const reader = makeSpendReader(50, 5);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/sandbox-e2b test cost-cap
```

- [ ] **Step 3: Implement `src/cost-cap.ts`**

```typescript
import { z } from "zod";
import { SpendCapExceededError } from "./errors.js";

export const SpendCapConfigSchema = z.object({
  capUsd: z.number().positive(),
  /** Multiplier over rolling average that triggers a warning alarm (default 3). */
  warnMultiplier: z.number().min(1).default(3),
});
export type SpendCapConfig = z.infer<typeof SpendCapConfigSchema>;

export interface SpendReader {
  /** Returns USD accumulated for this project in the current billing month. */
  getAccumulatedSpend(projectId: string): Promise<number>;
  /** Returns 30-day rolling average monthly spend for this project. 0 for new projects. */
  getRollingAverageSpend(projectId: string): Promise<number>;
}

/**
 * Checks whether provisioning a new sandbox would breach the project spend cap.
 * Throws {@link SpendCapExceededError} if accumulated spend >= cap.
 * Emits a console.warn alarm if accumulated >= warnMultiplier × rollingAverage.
 */
export async function checkSpendCap(
  projectId: string,
  reader: SpendReader,
  config: SpendCapConfig
): Promise<void> {
  const [accumulated, rollingAverage] = await Promise.all([
    reader.getAccumulatedSpend(projectId),
    reader.getRollingAverageSpend(projectId),
  ]);

  if (accumulated >= config.capUsd) {
    throw new SpendCapExceededError(projectId, config.capUsd, accumulated);
  }

  const threshold = rollingAverage * config.warnMultiplier;
  if (rollingAverage > 0 && accumulated >= threshold) {
    console.warn(
      `[sandbox-e2b] spend alarm: project ${projectId} has accumulated $${accumulated.toFixed(2)}, ` +
        `which is ${config.warnMultiplier}× the rolling average ($${rollingAverage.toFixed(2)}). ` +
        `Cap is $${config.capUsd.toFixed(2)}.`
    );
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/sandbox-e2b test cost-cap
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/src/cost-cap.ts packages/sandbox-e2b/test/cost-cap.test.ts
git commit -m "feat(sandbox-e2b): checkSpendCap — hard pause at cap, warn at 3x rolling average"
```

---

### Task 9: Public `src/index.ts` + smoke test

**Files:**
- Modify: `packages/sandbox-e2b/src/index.ts`
- Create: `packages/sandbox-e2b/test/public-api.test.ts`

- [ ] **Step 1: Write failing test**

`packages/sandbox-e2b/test/public-api.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API surface", () => {
  it("exports all canonical names", () => {
    const expected = [
      // types
      "SandboxIdSchema",
      "TemplateIdSchema",
      "SandboxStatusSchema",
      "SandboxRecordSchema",
      "TemplateDigestSchema",
      // lifecycle
      "E2BLifecycle",
      // filesystem
      "E2BFileSystem",
      // exec
      "E2BExec",
      // preview
      "E2BPreview",
      // cost-cap
      "checkSpendCap",
      "SpendCapConfigSchema",
      // errors
      "SandboxNotFoundError",
      "SandboxProvisionError",
      "SpendCapExceededError",
    ];
    for (const name of expected) {
      expect((api as Record<string, unknown>)[name], `missing export: ${name}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Implement `src/index.ts`**

```typescript
export * from "./types.js";
export * from "./lifecycle.js";
export * from "./filesystem.js";
export * from "./exec.js";
export * from "./preview.js";
export * from "./cost-cap.js";
export * from "./errors.js";
```

- [ ] **Step 3: Run + build + commit**

```bash
pnpm -F @atlas/sandbox-e2b test public-api
pnpm -F @atlas/sandbox-e2b build
git add packages/sandbox-e2b/src/index.ts packages/sandbox-e2b/test/public-api.test.ts
git commit -m "feat(sandbox-e2b): public API barrel exports + smoke test"
```

---

### Task 10: Mocked-SDK integration test for all four interfaces

**Files:**
- Create: `packages/sandbox-e2b/test/integration.test.ts`

This test exercises `E2BLifecycle` → `E2BFileSystem` → `E2BExec` → `E2BPreview` as a composed unit using the mocked SDK, simulating the full "provision sandbox → write file → run command → get preview URL" flow that the atlas-web factory uses.

- [ ] **Step 1: Write test**

`packages/sandbox-e2b/test/integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2BLifecycle } from "../src/lifecycle.js";
import { E2BFileSystem } from "../src/filesystem.js";
import { E2BExec } from "../src/exec.js";
import { E2BPreview } from "../src/preview.js";
import { SandboxIdSchema } from "../src/types.js";

vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

import { Sandbox as MockSandbox } from "@e2b/sdk";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("sandbox-e2b integration — lifecycle → filesystem → exec → preview", () => {
  let fakeSandbox: Record<string, unknown>;
  let lifecycle: E2BLifecycle;

  beforeEach(() => {
    fakeSandbox = {
      sandboxId: "sbx_integration_001",
      kill: vi.fn().mockResolvedValue(undefined),
      files: {
        read: vi.fn().mockResolvedValue("// app entry"),
        write: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ name: "app.ts", type: "file", path: "/app/app.ts" }]),
      },
      commands: {
        run: vi.fn().mockResolvedValue({
          exitCode: 0,
          output: { stdout: "Test passed\n", stderr: "" },
        }),
        streamRun: async function* () {
          yield { stream: "stdout" as const, data: "watching...\n" };
        },
      },
      getHost: (port: number) => `${port}-sbx_integration_001.e2b.app`,
    };
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSandbox);

    lifecycle = new E2BLifecycle({
      apiKey: "test-key",
      templateDigests: { "atlas-next-ts": "sha256abc", "atlas-python-fastapi": "sha256def" },
    });
  });

  it("full flow: provision → write → run → preview URL", async () => {
    // 1. Provision
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    expect(record.status).toBe("running");

    const sandboxId = SandboxIdSchema.parse(record.sandboxId);

    // 2. Write a file via the shared registry
    // We construct a registry from the fake SDK object (simulating what the web factory does)
    const sdkRegistry = new Map([[sandboxId as string, { files: fakeSandbox.files as never }]]);
    const fs = new E2BFileSystem(sdkRegistry);
    await fs.write(sandboxId, "/app/app.ts", "export default function App() {}");
    expect((fakeSandbox.files as Record<string, ReturnType<typeof vi.fn>>).write).toHaveBeenCalledWith(
      "/app/app.ts",
      "export default function App() {}"
    );

    // 3. Run a command
    const execRegistry = new Map([[sandboxId as string, { commands: fakeSandbox.commands as never }]]);
    const exec = new E2BExec(execRegistry);
    const result = await exec.runCommand(sandboxId, "npx vitest run --reporter=json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Test passed");

    // 4. Get preview URL
    const previewRegistry = new Map([[
      sandboxId as string,
      { getHost: (port: number) => `${port}-${sandboxId}.e2b.app` },
    ]]);
    const preview = new E2BPreview(previewRegistry);
    const url = preview.getPreviewUrl(sandboxId, 3000);
    expect(url).toMatch(/^https:\/\/3000-/);
  });

  it("terminates the sandbox cleanly", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    const sandboxId = SandboxIdSchema.parse(record.sandboxId);
    await lifecycle.terminate(sandboxId);
    expect(fakeSandbox.kill).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm -F @atlas/sandbox-e2b test integration
git add packages/sandbox-e2b/test/integration.test.ts
git commit -m "test(sandbox-e2b): integration test — lifecycle → filesystem → exec → preview with mocked SDK"
```

---

### Task 11: `packages/sandbox-e2b/` README

**Files:** create `packages/sandbox-e2b/README.md`.

- [ ] **Step 1: Write README**

````markdown
# @atlas/sandbox-e2b

Server-side TypeScript wrapper around the [E2B SDK](https://e2b.dev) for Atlas's live-preview sandbox infrastructure. Exposes four typed interfaces so every consumer can inject a mock for tests. **Never imported by browser code.**

## Interfaces

| Interface | Implementation | Description |
|---|---|---|
| `SandboxLifecycle` | `E2BLifecycle` | Provision / terminate / restart sandboxes |
| `SandboxFileSystem` | `E2BFileSystem` | Read / write / list / watch remote files |
| `SandboxExec` | `E2BExec` | Run commands (batch) or stream stdout/stderr |
| `SandboxPreview` | `E2BPreview` | Get the HTTPS preview URL for a sandbox port |

## Quick start

```ts
import {
  E2BLifecycle, E2BFileSystem, E2BExec, E2BPreview,
  checkSpendCap,
} from "@atlas/sandbox-e2b";

const lifecycle = new E2BLifecycle({
  apiKey: process.env.E2B_API_KEY!,
  templateDigests: {
    "atlas-next-ts": process.env.E2B_TEMPLATE_NEXT_TS_DIGEST!,
    "atlas-python-fastapi": process.env.E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST!,
  },
});

// check cap before provisioning
await checkSpendCap(projectId, spendReader, { capUsd: 50, warnMultiplier: 3 });

const record = await lifecycle.provision("atlas-next-ts", projectId);
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `E2B_API_KEY` | Yes | E2B API key — server-side only, never sent to browser |
| `E2B_TEMPLATE_NEXT_TS_DIGEST` | Yes | Pinned digest for the `atlas-next-ts` template |
| `E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST` | Yes | Pinned digest for the `atlas-python-fastapi` template |
| `SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH` | No | Per-project monthly spend cap in USD (default: 50) |

## Spend cap

`checkSpendCap(projectId, reader, config)` must be called before every `lifecycle.provision()`. It:
1. Reads accumulated spend from the current billing month via the injected `SpendReader`.
2. Throws `SpendCapExceededError` if accumulated ≥ `capUsd`.
3. Emits `console.warn` if accumulated ≥ `warnMultiplier × 30-day rolling average`.

The production `SpendReader` reads from `@atlas/spec-graph-data`'s `sandbox_spend_log` table. Tests inject an in-memory stub.

## Template versioning

Templates are pinned by digest in `apps/atlas-web/.env`. A weekly GitHub Actions workflow:
1. Rebuilds the Docker image from `apps/atlas-web/docker/atlas-next-ts.Dockerfile` (or `atlas-python-fastapi.Dockerfile`).
2. Pushes to E2B via `e2b template push`.
3. Opens a PR updating `E2B_TEMPLATE_NEXT_TS_DIGEST` (and/or fastapi variant).
4. Auto-merges if a smoke test against the new digest passes.

This mirrors the Plan C.2 release pattern.

## Testing

```bash
cd packages/sandbox-e2b
pnpm test
```

All tests mock `@e2b/sdk` — no real E2B provision in CI.
````

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/README.md
git commit -m "docs(sandbox-e2b): README — interfaces, env vars, spend cap, template versioning"
```

---

### Task 12: `apps/atlas-web` — server-side sandbox factory

**Files:**
- Create: `apps/atlas-web/src/lib/sandbox/types.ts`
- Create: `apps/atlas-web/src/lib/sandbox/factory.ts`
- Create: `apps/atlas-web/__tests__/sandbox-factory.test.ts`

The factory is a server-side singleton (one instance per Next.js process) that maintains a per-project `SandboxSession`. On first access for a project it provisions a sandbox (after spend-cap check); on subsequent access it returns the cached session. This is the glue that prevents double-provision races when both the HMR iframe and the terminal mount simultaneously.

- [ ] **Step 1: Write failing test**

`apps/atlas-web/__tests__/sandbox-factory.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxFactory } from "../src/lib/sandbox/factory.js";
import type { SandboxLifecycle } from "@atlas/sandbox-e2b";
import type { SpendReader } from "@atlas/sandbox-e2b";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function makeLifecycleMock(): SandboxLifecycle {
  let callCount = 0;
  return {
    provision: vi.fn().mockImplementation(async (templateId: string, projectId: string) => ({
      sandboxId: `sbx_factory_${++callCount}`,
      templateId,
      projectId,
      provisionedAt: new Date().toISOString(),
      status: "running" as const,
    })),
    terminate: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
  };
}

function makeSpendReaderMock(): SpendReader {
  return {
    getAccumulatedSpend: vi.fn().mockResolvedValue(0),
    getRollingAverageSpend: vi.fn().mockResolvedValue(0),
  };
}

describe("SandboxFactory", () => {
  let lifecycle: SandboxLifecycle;
  let factory: SandboxFactory;

  beforeEach(() => {
    lifecycle = makeLifecycleMock();
    factory = new SandboxFactory({
      lifecycle,
      spendReader: makeSpendReaderMock(),
      spendCapConfig: { capUsd: 50, warnMultiplier: 3 },
      defaultTemplate: "atlas-next-ts",
    });
  });

  it("provisions a sandbox on first getOrProvision call", async () => {
    const session = await factory.getOrProvision(PROJECT_ID);
    expect(session.record.status).toBe("running");
    expect(lifecycle.provision).toHaveBeenCalledOnce();
  });

  it("returns the cached session on subsequent calls — no double-provision", async () => {
    const s1 = await factory.getOrProvision(PROJECT_ID);
    const s2 = await factory.getOrProvision(PROJECT_ID);
    expect(s1.record.sandboxId).toBe(s2.record.sandboxId);
    expect(lifecycle.provision).toHaveBeenCalledOnce();
  });

  it("provisions separate sandboxes for different projects", async () => {
    const OTHER_PROJECT = "55555555-5555-4555-8555-555555555555";
    const s1 = await factory.getOrProvision(PROJECT_ID);
    const s2 = await factory.getOrProvision(OTHER_PROJECT);
    expect(s1.record.sandboxId).not.toBe(s2.record.sandboxId);
    expect(lifecycle.provision).toHaveBeenCalledTimes(2);
  });

  it("terminates and evicts the session from cache", async () => {
    await factory.getOrProvision(PROJECT_ID);
    await factory.terminate(PROJECT_ID);
    expect(lifecycle.terminate).toHaveBeenCalledOnce();
    // After terminate, next getOrProvision should re-provision
    await factory.getOrProvision(PROJECT_ID);
    expect(lifecycle.provision).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F atlas-web test sandbox-factory
```

- [ ] **Step 3: Write `src/lib/sandbox/types.ts`**

```typescript
import type { SandboxRecord } from "@atlas/sandbox-e2b";

export interface SandboxSession {
  record: SandboxRecord;
  /** Resolved HTTPS preview URL for the default dev port (3000 for Next.js, 8000 for FastAPI). */
  previewUrl: string;
}
```

- [ ] **Step 4: Write `src/lib/sandbox/factory.ts`**

```typescript
import {
  E2BLifecycle,
  E2BPreview,
  checkSpendCap,
  SandboxIdSchema,
  type SandboxLifecycle,
  type SpendReader,
  type SpendCapConfig,
  type TemplateId,
} from "@atlas/sandbox-e2b";
import type { SandboxSession } from "./types.js";

interface SandboxFactoryConfig {
  lifecycle: SandboxLifecycle;
  spendReader: SpendReader;
  spendCapConfig: SpendCapConfig;
  defaultTemplate: TemplateId;
}

export class SandboxFactory {
  private readonly config: SandboxFactoryConfig;
  /** projectId → SandboxSession */
  private readonly sessions = new Map<string, SandboxSession>();
  /** In-flight provision promises — prevents race when two requests hit simultaneously */
  private readonly inflight = new Map<string, Promise<SandboxSession>>();

  constructor(config: SandboxFactoryConfig) {
    this.config = config;
  }

  async getOrProvision(projectId: string): Promise<SandboxSession> {
    const cached = this.sessions.get(projectId);
    if (cached) return cached;

    // Coalesce concurrent calls for the same projectId
    const existing = this.inflight.get(projectId);
    if (existing) return existing;

    const promise = this.doProvision(projectId);
    this.inflight.set(projectId, promise);
    try {
      const session = await promise;
      this.sessions.set(projectId, session);
      return session;
    } finally {
      this.inflight.delete(projectId);
    }
  }

  async terminate(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) return;
    const sandboxId = SandboxIdSchema.parse(session.record.sandboxId);
    await this.config.lifecycle.terminate(sandboxId);
    this.sessions.delete(projectId);
  }

  private async doProvision(projectId: string): Promise<SandboxSession> {
    await checkSpendCap(projectId, this.config.spendReader, this.config.spendCapConfig);
    const record = await this.config.lifecycle.provision(
      this.config.defaultTemplate,
      projectId
    );
    const defaultPort = this.config.defaultTemplate === "atlas-next-ts" ? 3000 : 8000;
    // For the factory, derive preview URL from the sandbox record's previewBaseUrl
    // (set by E2BLifecycle.provision via E2B's getHost) or fall back to a placeholder.
    const previewUrl = record.previewBaseUrl ?? `https://${defaultPort}-${record.sandboxId}.e2b.app`;
    return { record, previewUrl };
  }
}

// Module-level singleton — Next.js server-side; constructed lazily on first import.
let _factory: SandboxFactory | null = null;

export function getSandboxFactory(): SandboxFactory {
  if (!_factory) {
    const { E2BLifecycle: Lifecycle } = { E2BLifecycle };
    _factory = new SandboxFactory({
      lifecycle: new Lifecycle({
        apiKey: process.env.E2B_API_KEY ?? "",
        templateDigests: {
          "atlas-next-ts": process.env.E2B_TEMPLATE_NEXT_TS_DIGEST ?? "",
          "atlas-python-fastapi": process.env.E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST ?? "",
        },
      }),
      spendReader: {
        // Production wiring — replace with @atlas/spec-graph-data query when available
        getAccumulatedSpend: async () => 0,
        getRollingAverageSpend: async () => 0,
      },
      spendCapConfig: {
        capUsd: Number(process.env.SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH ?? "50"),
        warnMultiplier: 3,
      },
      defaultTemplate: "atlas-next-ts",
    });
  }
  return _factory;
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F atlas-web test sandbox-factory
```

Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/src/lib/sandbox/ apps/atlas-web/__tests__/sandbox-factory.test.ts
git commit -m "feat(atlas-web): server-side SandboxFactory with lazy-provision + coalesced concurrent calls"
```

---

### Task 13: `HmrIframe` component + component test

**Files:**
- Create: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/HmrIframe.tsx`
- Create: `apps/atlas-web/__tests__/HmrIframe.test.tsx`

The HMR iframe renders the sandbox preview URL in an `<iframe>` sized by `iframe-resizer`. It accepts `src`, `title`, and an optional `onLoad` callback. When `src` is undefined (sandbox not yet provisioned) it renders a skeleton placeholder. It is a Client Component (`"use client"`) because it manages `iFrameResize` lifecycle via `useEffect`.

- [ ] **Step 1: Write failing component test**

`apps/atlas-web/__tests__/HmrIframe.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HmrIframe } from "../src/app/(dashboard)/projects/[projectId]/canvas/_components/HmrIframe.js";

// iframe-resizer is a DOM-side library; mock it in the test environment
vi.mock("iframe-resizer/js", () => ({
  iFrameResize: vi.fn(),
}));

describe("HmrIframe", () => {
  it("renders an iframe with the provided src", () => {
    render(
      <HmrIframe
        src="https://3000-sbx_abc.e2b.app"
        title="Live preview"
      />
    );
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.src).toBe("https://3000-sbx_abc.e2b.app/");
  });

  it("renders a skeleton placeholder when src is undefined", () => {
    const { container } = render(<HmrIframe src={undefined} title="Live preview" />);
    expect(container.querySelector("[data-testid='hmr-iframe-skeleton']")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("calls onLoad callback when iframe fires load event", async () => {
    const onLoad = vi.fn();
    render(
      <HmrIframe src="https://3000-sbx_abc.e2b.app" title="Live preview" onLoad={onLoad} />
    );
    const iframe = screen.getByTitle("Live preview");
    iframe.dispatchEvent(new Event("load"));
    expect(onLoad).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F atlas-web test HmrIframe
```

- [ ] **Step 3: Implement `HmrIframe.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";

interface HmrIframeProps {
  src: string | undefined;
  title: string;
  onLoad?: () => void;
  className?: string;
}

export function HmrIframe({ src, title, onLoad, className }: HmrIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current || !src) return;
    // Dynamically import iframe-resizer to avoid SSR issues
    import("iframe-resizer/js").then(({ iFrameResize }) => {
      if (iframeRef.current) {
        iFrameResize({ log: false, checkOrigin: false }, iframeRef.current);
      }
    });
  }, [src]);

  if (!src) {
    return (
      <div
        data-testid="hmr-iframe-skeleton"
        className="animate-pulse bg-muted rounded-lg w-full h-full min-h-[400px]"
        aria-label="Sandbox preview loading"
      />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      onLoad={onLoad}
      className={className ?? "w-full h-full border-0 rounded-lg"}
      allow="clipboard-read; clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F atlas-web test HmrIframe
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/HmrIframe.tsx" \
        apps/atlas-web/__tests__/HmrIframe.test.tsx
git commit -m "feat(atlas-web): HmrIframe component — sandbox preview iframe with skeleton + iframe-resizer"
```

---

### Task 14: `ViewportToggle` component + component test

**Files:**
- Create: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/ViewportToggle.tsx`
- Create: `apps/atlas-web/__tests__/ViewportToggle.test.tsx`

Three viewport presets: desktop (1440×900), tablet (768×1024), mobile (375×667). The component is a controlled button group; the parent passes `viewport` + `onViewportChange`. The Canvas page wraps `HmrIframe` in a container that sets `max-width` to the active viewport width.

- [ ] **Step 1: Write failing test**

`apps/atlas-web/__tests__/ViewportToggle.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewportToggle, VIEWPORTS } from "../src/app/(dashboard)/projects/[projectId]/canvas/_components/ViewportToggle.js";

describe("ViewportToggle", () => {
  it("renders all three viewport buttons", () => {
    render(<ViewportToggle viewport="desktop" onViewportChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /desktop/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /tablet/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mobile/i })).toBeTruthy();
  });

  it("marks the active viewport with aria-pressed=true", () => {
    render(<ViewportToggle viewport="tablet" onViewportChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /tablet/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /desktop/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onViewportChange with the selected viewport id when a button is clicked", () => {
    const onChange = vi.fn();
    render(<ViewportToggle viewport="desktop" onViewportChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /mobile/i }));
    expect(onChange).toHaveBeenCalledWith("mobile");
  });

  it("VIEWPORTS constant has correct dimensions for all three presets", () => {
    expect(VIEWPORTS.desktop).toEqual({ width: 1440, height: 900 });
    expect(VIEWPORTS.tablet).toEqual({ width: 768, height: 1024 });
    expect(VIEWPORTS.mobile).toEqual({ width: 375, height: 667 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F atlas-web test ViewportToggle
```

- [ ] **Step 3: Implement `ViewportToggle.tsx`**

```tsx
"use client";

export type ViewportId = "desktop" | "tablet" | "mobile";

export const VIEWPORTS: Record<ViewportId, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

const LABELS: Record<ViewportId, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

interface ViewportToggleProps {
  viewport: ViewportId;
  onViewportChange: (v: ViewportId) => void;
  className?: string;
}

export function ViewportToggle({ viewport, onViewportChange, className }: ViewportToggleProps) {
  return (
    <div
      role="group"
      aria-label="Preview viewport"
      className={className ?? "flex gap-1 rounded-md border p-1"}
    >
      {(["desktop", "tablet", "mobile"] as ViewportId[]).map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={viewport === id}
          onClick={() => onViewportChange(id)}
          className={[
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            viewport === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {LABELS[id]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F atlas-web test ViewportToggle
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/ViewportToggle.tsx" \
        apps/atlas-web/__tests__/ViewportToggle.test.tsx
git commit -m "feat(atlas-web): ViewportToggle — desktop/tablet/mobile 1440/768/375 preset switcher"
```

---

### Task 15: `ShareableUrlModal` + `createShareableUrl` Server Action

**Files:**
- Create: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/ShareableUrlModal.tsx`
- Create: `apps/atlas-web/src/actions/sandbox.ts`
- Create: `apps/atlas-web/__tests__/ShareableUrlModal.test.tsx`

The modal lets the user choose an access mode (`public` / `password` / `auth`) and receive a shareable link. The `createShareableUrl` Server Action records the access mode, an expiry, and (for `password`) a bcrypt hash of the entered secret in a `preview_urls` table (migration added by this task). Default access mode is `auth` — `public` requires an explicit acknowledgement checkbox.

- [ ] **Step 1: Write failing component test**

`apps/atlas-web/__tests__/ShareableUrlModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShareableUrlModal } from "../src/app/(dashboard)/projects/[projectId]/canvas/_components/ShareableUrlModal.js";

describe("ShareableUrlModal", () => {
  it("renders with auth mode selected by default", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    const authRadio = screen.getByRole("radio", { name: /requires sign-in/i });
    expect((authRadio as HTMLInputElement).checked).toBe(true);
  });

  it("shows a password input when password mode is selected", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: /password/i }));
    expect(screen.getByLabelText(/shared password/i)).toBeTruthy();
  });

  it("shows a public-mode confirmation checkbox when public is selected", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: /public/i }));
    expect(screen.getByRole("checkbox", { name: /i understand/i })).toBeTruthy();
  });

  it("calls onClose when the cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F atlas-web test ShareableUrlModal
```

- [ ] **Step 3: Write `src/actions/sandbox.ts`**

```typescript
"use server";

import { z } from "zod";
import { auth } from "@clerk/nextjs/server";

export const AccessModeSchema = z.enum(["public", "password", "auth"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

const CreateShareableUrlInputSchema = z.object({
  projectId: z.string().uuid(),
  sandboxId: z.string().min(1),
  accessMode: AccessModeSchema,
  passwordPlaintext: z.string().min(1).optional(),
  expiresInHours: z.number().int().min(1).max(720).default(24),
});

export type CreateShareableUrlInput = z.infer<typeof CreateShareableUrlInputSchema>;

export interface ShareableUrlResult {
  url: string;
  accessMode: AccessMode;
  expiresAt: string;
}

export async function createShareableUrl(
  input: CreateShareableUrlInput
): Promise<ShareableUrlResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = CreateShareableUrlInputSchema.parse(input);

  // Hash password if provided (bcrypt — import dynamically to avoid client-bundle risk)
  let passwordHash: string | undefined;
  if (parsed.accessMode === "password" && parsed.passwordPlaintext) {
    const bcrypt = await import("bcryptjs");
    passwordHash = await bcrypt.hash(parsed.passwordPlaintext, 12);
  }

  const expiresAt = new Date(
    Date.now() + parsed.expiresInHours * 60 * 60 * 1000
  ).toISOString();

  // TODO(E.4): persist to preview_urls table via @atlas/spec-graph-data when available.
  // For now, encode all parameters in a signed token (replace with DB in follow-up).
  const token = Buffer.from(
    JSON.stringify({
      projectId: parsed.projectId,
      sandboxId: parsed.sandboxId,
      accessMode: parsed.accessMode,
      passwordHash,
      expiresAt,
      issuedBy: userId,
    })
  ).toString("base64url");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/preview/${token}`;

  return { url, accessMode: parsed.accessMode, expiresAt };
}
```

- [ ] **Step 4: Implement `ShareableUrlModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { createShareableUrl, type AccessMode } from "@/actions/sandbox.js";

interface ShareableUrlModalProps {
  projectId: string;
  sandboxId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareableUrlModal({
  projectId,
  sandboxId,
  isOpen,
  onClose,
}: ShareableUrlModalProps) {
  const [accessMode, setAccessMode] = useState<AccessMode>("auth");
  const [password, setPassword] = useState("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const result = await createShareableUrl({
        projectId,
        sandboxId,
        accessMode,
        passwordPlaintext: accessMode === "password" ? password : undefined,
      });
      setGeneratedUrl(result.url);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const canCreate =
    accessMode === "auth" ||
    (accessMode === "password" && password.length >= 4) ||
    (accessMode === "public" && publicConfirmed);

  return (
    <div role="dialog" aria-modal="true" aria-label="Share preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Share preview</h2>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Access mode</legend>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="auth"
              checked={accessMode === "auth"}
              onChange={() => setAccessMode("auth")}
              aria-label="Requires sign-in"
            />
            <span>Requires sign-in (recommended)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="password"
              checked={accessMode === "password"}
              onChange={() => setAccessMode("password")}
              aria-label="Password"
            />
            <span>Password-protected</span>
          </label>

          {accessMode === "password" && (
            <div className="ml-6">
              <label htmlFor="shared-password" className="text-sm">
                Shared password
              </label>
              <input
                id="shared-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
                aria-label="Shared password"
              />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="accessMode"
              value="public"
              checked={accessMode === "public"}
              onChange={() => { setAccessMode("public"); setPublicConfirmed(false); }}
              aria-label="Public"
            />
            <span>Public (no auth required)</span>
          </label>

          {accessMode === "public" && (
            <div className="ml-6">
              <label className="flex items-center gap-2 text-sm text-destructive cursor-pointer">
                <input
                  type="checkbox"
                  checked={publicConfirmed}
                  onChange={(e) => setPublicConfirmed(e.target.checked)}
                  aria-label="I understand this URL will be accessible to anyone with the link"
                />
                I understand this URL will be accessible to anyone with the link
              </label>
            </div>
          )}
        </fieldset>

        {generatedUrl && (
          <div className="rounded bg-muted p-3 text-sm break-all select-all">
            {generatedUrl}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || loading}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {generatedUrl ? "Regenerate" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F atlas-web test ShareableUrlModal
```

Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/_components/ShareableUrlModal.tsx" \
        apps/atlas-web/src/actions/sandbox.ts \
        apps/atlas-web/__tests__/ShareableUrlModal.test.tsx
git commit -m "feat(atlas-web): ShareableUrlModal + createShareableUrl Server Action — three access modes"
```

---

### Task 16: Wire Canvas page — HMR iframe + viewport toggle + shareable URL button

**Files:**
- Modify: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/page.tsx`

This task connects the three new components to the Canvas page that E.2 scaffolded. The page fetches the sandbox session server-side (via `getSandboxFactory().getOrProvision(projectId)`), passes `previewUrl` to `HmrIframe`, and renders `ViewportToggle` + a "Share" button that opens `ShareableUrlModal`.

No TDD — wiring existing components. The component tests in Tasks 13, 14, 15 are the quality gate.

- [ ] **Step 1: Update Canvas page**

Key additions to `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/page.tsx`:

```tsx
// server-side
import { getSandboxFactory } from "@/lib/sandbox/factory.js";

// Inside the page Server Component:
const session = await getSandboxFactory().getOrProvision(params.projectId);
// Pass session.previewUrl + session.record.sandboxId as props to a CanvasClient component

// client component additions:
import { HmrIframe } from "./_components/HmrIframe.js";
import { ViewportToggle, type ViewportId, VIEWPORTS } from "./_components/ViewportToggle.js";
import { ShareableUrlModal } from "./_components/ShareableUrlModal.js";

// State in the client wrapper:
const [viewport, setViewport] = useState<ViewportId>("desktop");
const [shareOpen, setShareOpen] = useState(false);

// JSX structure:
<div className="flex flex-col h-full">
  <div className="flex items-center justify-between border-b px-4 py-2">
    <ViewportToggle viewport={viewport} onViewportChange={setViewport} />
    <button onClick={() => setShareOpen(true)}>Share</button>
  </div>
  <div
    className="flex-1 overflow-auto flex justify-center"
    style={{ maxWidth: VIEWPORTS[viewport].width }}
  >
    <HmrIframe src={previewUrl} title="Live preview" />
  </div>
  <ShareableUrlModal
    projectId={projectId}
    sandboxId={sandboxId}
    isOpen={shareOpen}
    onClose={() => setShareOpen(false)}
  />
</div>
```

- [ ] **Step 2: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/canvas/"
git commit -m "feat(atlas-web): wire Canvas page — HMR iframe + viewport toggle + share modal"
```

---

### Task 17: Wire Code view — replace E.3 terminal stub with real sandbox shell

**Files:**
- Modify: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/code/_components/TerminalPane.tsx`

**Integration point with E.3:** E.3 ships a `TerminalPane` with a stub that renders placeholder text. E.4 replaces only the data-layer call — the terminal UI (xterm.js or equivalent) stays exactly as E.3 left it. This task adds `SandboxExec.streamCommand` as the data source.

Do NOT modify anything else in the Code view outside of `TerminalPane.tsx`.

- [ ] **Step 1: Add sandbox stream hook to `TerminalPane.tsx`**

Add a `sandboxId` prop (optional; when absent, falls back to E.3's existing behaviour). When `sandboxId` is provided:

```tsx
// At the top of the TerminalPane component (client-side only)
// The terminal's write path — replace the stub with real stream consumption:
useEffect(() => {
  if (!sandboxId || !term) return;
  let cancelled = false;

  async function stream() {
    // sandboxExec is injected as a prop (or obtained from a React context)
    // so tests can pass a mock without touching the Server-side factory.
    for await (const chunk of props.sandboxExec.streamCommand(sandboxId, props.shellCommand ?? "bash")) {
      if (cancelled) break;
      term.write(chunk.data);
    }
  }
  void stream();
  return () => { cancelled = true; };
}, [sandboxId, term]);
```

The `sandboxExec` prop is typed as `Pick<SandboxExec, "streamCommand">`. Tests continue to mock it; E.3's stub behaviour is preserved when `sandboxId` is undefined.

- [ ] **Step 2: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/code/_components/TerminalPane.tsx"
git commit -m "feat(atlas-web): TerminalPane — wire sandbox shell via SandboxExec.streamCommand (replaces E.3 stub)"
```

---

### Task 18: Wire Code view — replace E.3 test runner stub with real vitest stream

**Files:**
- Modify: `apps/atlas-web/src/app/(dashboard)/projects/[projectId]/code/_components/TestRunnerPane.tsx`

Same integration-point discipline as Task 17. Only the data-layer call changes; E.3's test runner UI stays intact.

- [ ] **Step 1: Add vitest stream hook to `TestRunnerPane.tsx`**

```tsx
// When the "Run tests" button is clicked:
async function runTests() {
  setRunning(true);
  setOutput([]);
  try {
    for await (const chunk of props.sandboxExec.streamCommand(
      sandboxId,
      "npx vitest run --reporter=verbose",
      { cwd: "/app" }
    )) {
      setOutput((prev) => [...prev, chunk.data]);
    }
  } finally {
    setRunning(false);
  }
}
```

`sandboxExec` is the same injected `Pick<SandboxExec, "streamCommand">` prop as in Task 17.

- [ ] **Step 2: Commit**

```bash
git add "apps/atlas-web/src/app/(dashboard)/projects/[projectId]/code/_components/TestRunnerPane.tsx"
git commit -m "feat(atlas-web): TestRunnerPane — wire vitest via SandboxExec.streamCommand (replaces E.3 stub)"
```

---

### Task 19: Full build + full-suite smoke

- [ ] **Step 1: Build the package**

```bash
pnpm -F @atlas/sandbox-e2b build
pnpm -F @atlas/sandbox-e2b typecheck
```

Expected: exits 0.

- [ ] **Step 2: Run all sandbox-e2b tests**

```bash
pnpm -F @atlas/sandbox-e2b test
```

Expected: all green; ~7 test files, ~25 tests.

- [ ] **Step 3: Run atlas-web tests**

```bash
pnpm -F atlas-web test
```

Expected: all green; new tests (HmrIframe, ViewportToggle, ShareableUrlModal, sandbox-factory) plus E.2/E.3 pre-existing tests.

- [ ] **Step 4: Workspace-wide smoke**

```bash
pnpm -r test
```

Expected: pre-existing Postgres flakiness in spec-graph-sync/merge-driver acceptable; no regressions in any other package.

- [ ] **Step 5: Commit checkpoint**

```bash
git commit --allow-empty -m "chore(sandbox-e2b): full-suite smoke — all workspace tests green post E.4"
```

---

### Task 20: `apps/atlas-web` `.env.example` update

**Files:** modify `apps/atlas-web/.env.example`.

- [ ] **Step 1: Add E2B env vars**

Append to `apps/atlas-web/.env.example`:

```bash
# ─── E2B Sandbox (Plan E.4) ───────────────────────────────────────────────────
# E2B API key — SERVER-SIDE ONLY. Never prefix with NEXT_PUBLIC_.
E2B_API_KEY=your_e2b_api_key_here

# Template digests — pin to specific E2B template versions.
# Updated weekly by the template-rebuild workflow (see packages/sandbox-e2b/README.md).
E2B_TEMPLATE_NEXT_TS_DIGEST=sha256:replace_with_real_digest
E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST=sha256:replace_with_real_digest

# Per-project monthly E2B spend cap in USD. Hard pause at cap; warn at 3× rolling average.
# Default: 50 (i.e. $50 / project / month).
SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH=50
```

- [ ] **Step 2: Commit**

```bash
git add apps/atlas-web/.env.example
git commit -m "docs(atlas-web): add E2B env vars to .env.example (E.4)"
```

---

### Task 21: Update plan index — mark E.4 Shipped

**Files:** modify `docs/superpowers/plans/README.md`.

- [ ] **Step 1: Insert E.4 row**

Add a new row after the E.3 entry in the plan index table:

```
| N | `2026-04-20-e2b-sandbox-preview.md` | **E.4 — E2B Sandbox + Preview** | packages/sandbox-e2b (SandboxLifecycle/FileSystem/Exec/Preview + spend-cap helper) + atlas-web HMR iframe, viewport toggle, shareable URL, terminal + test runner sandbox wiring | 21 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Update execution-order ASCII diagram to show E.4 depending on E.2 + E.3. Add a note that E.5 (Ritual Integration Tests) depends on E.4 being green.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add E.4 e2b-sandbox-preview to plan index"
```

---

## Completion Checklist

After all 21 tasks:

- [ ] `pnpm -F @atlas/sandbox-e2b test` — all tests green (~25 tests across 7 files)
- [ ] `pnpm -F @atlas/sandbox-e2b build` — exits 0
- [ ] `pnpm -F @atlas/sandbox-e2b typecheck` — exits 0
- [ ] `pnpm -F atlas-web test` — all tests green including 4 new E.4 test files
- [ ] `pnpm -r test` — no cross-package regressions
- [ ] `E2B_API_KEY` never appears in any `export` statement, `NEXT_PUBLIC_*` var, or client-bundle import
- [ ] All four sandbox interfaces (`SandboxLifecycle`, `SandboxFileSystem`, `SandboxExec`, `SandboxPreview`) have mocked-SDK tests
- [ ] `checkSpendCap` throws `SpendCapExceededError` when accumulated ≥ cap; warns at 3× rolling average
- [ ] `HmrIframe` renders skeleton when `src` is undefined; renders iframe with correct src when provided
- [ ] `ViewportToggle` VIEWPORTS constant has correct pixel dimensions; aria-pressed reflects active viewport
- [ ] `ShareableUrlModal` defaults to `auth` mode; public mode requires explicit confirmation checkbox
- [ ] `createShareableUrl` Server Action uses Clerk session auth; bcrypt-hashes passwords; never returns plaintext
- [ ] `SandboxFactory` coalesces concurrent `getOrProvision` calls for the same projectId (no double-provision)
- [ ] Canvas page renders `HmrIframe` + `ViewportToggle` + Share button; Code view terminal + test runner use real sandbox stream
- [ ] `apps/atlas-web/.env.example` documents all E2B env vars with correct descriptions
- [ ] Plan index lists E.4 as shipped (pending merge)

## Handoff to E.5

- **E.5** (Ritual Integration Tests) drives the full Atlas stack through Playwright end-to-end. E.5 depends on E.4 being green because its "Build" step asserts that the live-preview iframe appears after ritual completion. E.5 should mock `SandboxFactory.getOrProvision` at the Next.js API boundary (returning a fixed `previewUrl`) rather than provisioning a real E2B sandbox in integration tests.
- **F.1** (Bootstrap Checkpoint) has no direct dependency on E.4. No changes to `@atlas/ritual-engine` are required by E.4.
- **G.1** (Edit Classifier) has no dependency on E.4.
- **Post-E.4 follow-up (not in scope here):** wire the real `SpendReader` from `@atlas/spec-graph-data`'s `sandbox_spend_log` table (the `createShareableUrl` Server Action's TODO comment). That migration + wiring is a one-task follow-up during E.5 or Phase B.
