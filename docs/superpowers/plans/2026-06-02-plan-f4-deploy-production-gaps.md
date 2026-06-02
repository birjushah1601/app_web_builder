# Plan F.4 — Deploy production gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two production gaps from Plan F.2/F.3 — replace atlas-web's stub `branching`/`migrate` with real `PgBranchingAdapter` + `replayMigrationsToSchema` wiring, and add a `buildAndPushImages` helper to the orchestrator that runs (and fail-fasts on) per-service image builds BEFORE k8s apply.

**Architecture:** Two independent threads (factory wiring + image-builder helper) that compose at the existing `runDeployFromArtifacts` boundary. Reuses existing `@atlas/postgres-branching` adapters and the `BranchingPort`/`MigratePort` contracts the orchestrator already exposes.

**Tech Stack:** TypeScript pnpm monorepo, vitest, `child_process.spawn` for docker shell-out (injectable runner).

**Spec reference:** `docs/superpowers/specs/2026-06-02-plan-f4-deploy-production-gaps-design.md`

**Depends on:** Plans A–G + D.2 + F + F.2 + F.3 merged. Branch off current `main` (`3cd376f`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/deploy-orchestrator/src/image-builder.ts` | `buildAndPushImages` + `CommandRunner` + types |
| `packages/deploy-orchestrator/test/image-builder.test.ts` | Unit tests with injected fake runner |
| `packages/deploy-orchestrator/test/deploy-from-artifacts-image-build.test.ts` | Integration: image-build failure → throw before any k8s call |
| `apps/atlas-web/lib/engine/branching.ts` | Real `BranchingPort` + `MigratePort` adapters built atop `@atlas/postgres-branching` |
| `apps/atlas-web/test/lib/engine/branching.test.ts` | Adapter unit test (port behavior + migrate dispatch shape) |

### Modified files
| File | Change |
|---|---|
| `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` | Call `buildAndPushImages` BEFORE applying manifests; on failure throw before any k8s call |
| `packages/deploy-orchestrator/src/index.ts` | Export `buildAndPushImages`, `CommandRunner`, `ImageBuilderResult`, `BuildAndPushImagesOptions` |
| `apps/atlas-web/lib/engine/factory.ts` | Swap stub `branching`/`migrate` for `createDeployBranchingAdapter()`; add `DATABASE_URL_DEPLOY` to env handling |

---

## Tasks

### Task 1: `buildAndPushImages` helper — pure-ish, injectable runner

**Files:**
- Create: `packages/deploy-orchestrator/src/image-builder.ts`
- Create: `packages/deploy-orchestrator/test/image-builder.test.ts`

- [ ] **Step 1: Failing test** at `packages/deploy-orchestrator/test/image-builder.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildAndPushImages, type CommandRunner } from "../src/image-builder.js";

const IMAGES = [
  { serviceName: "api", dockerfilePath: "./services/api/Dockerfile", imageTag: "reg.local/atlas/api:abc123" },
  { serviceName: "web", dockerfilePath: "./services/web/Dockerfile", imageTag: "reg.local/atlas/web:abc123" }
];

describe("buildAndPushImages", () => {
  it("returns ok=true for every image when build + push succeed", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "Pushed\ndigest: sha256:deadbeef size: 1234", stderr: "", exitCode: 0 }));
    const r = await buildAndPushImages(IMAGES, { runner });
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r[0]?.serviceName).toBe("api");
    expect(r[0]?.digest).toBe("sha256:deadbeef");
  });

  it("invokes docker build with -t imageTag and -f dockerfilePath", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner, cwd: "/tmp/build" });
    expect(runner).toHaveBeenCalledWith(
      "docker",
      ["build", "-t", "reg.local/atlas/api:abc123", "-f", "./services/api/Dockerfile", "/tmp/build"],
      expect.objectContaining({ cwd: "/tmp/build" })
    );
  });

  it("invokes docker push with imageTag after a successful build", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner });
    expect(runner).toHaveBeenNthCalledWith(2, "docker", ["push", "reg.local/atlas/api:abc123"], expect.any(Object));
  });

  it("skips push when skipPush=true", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner, skipPush: true });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("docker", expect.arrayContaining(["build"]), expect.any(Object));
  });

  it("returns ok=false with stderr in error when build fails", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "no such file: ./missing/Dockerfile", exitCode: 1 }));
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/no such file/);
  });

  it("does NOT push when build fails", async () => {
    const runner = vi.fn<CommandRunner>(async () => ({ stdout: "", stderr: "build error", exitCode: 1 }));
    await buildAndPushImages([IMAGES[0]!], { runner });
    expect(runner).toHaveBeenCalledTimes(1);  // only the failed build call
  });

  it("returns ok=false when push fails (build OK + push non-zero)", async () => {
    const runner = vi.fn<CommandRunner>(async (_cmd, args) => {
      if (args[0] === "build") return { stdout: "", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "denied: requested access to the resource is denied", exitCode: 1 };
    });
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/denied/);
  });

  it("returns ok=true with digest undefined when push stdout has no digest line", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "Pushed (no digest)\n", stderr: "", exitCode: 0 }));
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(true);
    expect(r[0]?.digest).toBeUndefined();
  });

  it("processes every image even when one fails (sequential, fail-soft)", async () => {
    let call = 0;
    const runner: CommandRunner = vi.fn(async () => {
      call += 1;
      if (call === 1) return { stdout: "", stderr: "boom", exitCode: 1 };  // api build fails
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const r = await buildAndPushImages(IMAGES, { runner });
    expect(r).toHaveLength(2);
    expect(r[0]?.ok).toBe(false);
    expect(r[1]?.ok).toBe(true);
  });

  it("returns empty array when images is empty", async () => {
    const r = await buildAndPushImages([], {});
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run, expect failure (file doesn't exist).

- [ ] **Step 3: Implement** `packages/deploy-orchestrator/src/image-builder.ts`:

```ts
import { spawn } from "node:child_process";
import type { DeployArtifact } from "@atlas/workflow-engine";

export interface ImageBuilderResult {
  serviceName: string;
  imageTag: string;
  digest?: string;
  ok: boolean;
  error?: string;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface BuildAndPushImagesOptions {
  runner?: CommandRunner;
  cwd?: string;
  perBuildTimeoutMs?: number;
  skipPush?: boolean;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const DIGEST_RE = /digest:\s*(sha256:[a-f0-9]+)/i;

export const defaultCommandRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (opts?.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`command timed out after ${opts.timeoutMs}ms: ${cmd} ${args.join(" ")}`));
      }, opts.timeoutMs);
    }
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });

export async function buildAndPushImages(
  images: DeployArtifact["imageBuilds"],
  opts: BuildAndPushImagesOptions = {}
): Promise<ImageBuilderResult[]> {
  const runner = opts.runner ?? defaultCommandRunner;
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.perBuildTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: ImageBuilderResult[] = [];

  for (const img of images) {
    const buildArgs = ["build", "-t", img.imageTag, "-f", img.dockerfilePath, cwd];
    const buildRes = await runner("docker", buildArgs, { cwd, timeoutMs }).catch((err: Error) => ({
      stdout: "",
      stderr: err.message,
      exitCode: -1
    }));

    if (buildRes.exitCode !== 0) {
      results.push({
        serviceName: img.serviceName,
        imageTag: img.imageTag,
        ok: false,
        error: (buildRes.stderr || buildRes.stdout || `docker build exit ${buildRes.exitCode}`).trim()
      });
      continue;
    }

    if (opts.skipPush) {
      results.push({ serviceName: img.serviceName, imageTag: img.imageTag, ok: true });
      continue;
    }

    const pushRes = await runner("docker", ["push", img.imageTag], { cwd, timeoutMs }).catch((err: Error) => ({
      stdout: "",
      stderr: err.message,
      exitCode: -1
    }));

    if (pushRes.exitCode !== 0) {
      results.push({
        serviceName: img.serviceName,
        imageTag: img.imageTag,
        ok: false,
        error: (pushRes.stderr || pushRes.stdout || `docker push exit ${pushRes.exitCode}`).trim()
      });
      continue;
    }

    const digestMatch = DIGEST_RE.exec(pushRes.stdout);
    results.push({
      serviceName: img.serviceName,
      imageTag: img.imageTag,
      ok: true,
      ...(digestMatch?.[1] ? { digest: digestMatch[1] } : {})
    });
  }

  return results;
}
```

- [ ] **Step 4:** Export from `packages/deploy-orchestrator/src/index.ts`:

```ts
export {
  buildAndPushImages,
  defaultCommandRunner,
  type CommandRunner,
  type ImageBuilderResult,
  type BuildAndPushImagesOptions
} from "./image-builder.js";
```

- [ ] **Step 5:** Run + typecheck + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): buildAndPushImages helper with injectable runner (Plan F.4 Task 1)"
```

---

### Task 2: Wire `buildAndPushImages` into `runDeployFromArtifacts`; fail-fast before k8s apply

**Files:**
- Modify: `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`
- Create: `packages/deploy-orchestrator/test/deploy-from-artifacts-image-build.test.ts`

BEFORE applying any manifests, run `buildAndPushImages` against `input.deployArtifact.imageBuilds`. If any build fails, throw a `DeployError` immediately — no rollback needed (nothing applied yet). On all-success, attach the results to the returned `DeployFromArtifactsResult` for observability.

- [ ] **Step 1: Update `DeployFromArtifactsOptions`** to accept an optional `imageRunner` + `skipImagePush`:

```ts
import type { CommandRunner } from "./image-builder.js";
import type { ImageBuilderResult } from "./image-builder.js";

export interface DeployFromArtifactsOptions {
  // ...existing...
  imageRunner?: CommandRunner;
  skipImagePush?: boolean;
}

export interface DeployFromArtifactsResult {
  // ...existing...
  imageBuilds?: ImageBuilderResult[];
}
```

- [ ] **Step 2: Failing test** at `packages/deploy-orchestrator/test/deploy-from-artifacts-image-build.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { runDeployFromArtifacts } from "../src/deploy-from-artifacts.js";
import type { CommandRunner } from "../src/image-builder.js";
import type { IacArtifact, DeployArtifact } from "@atlas/workflow-engine";

const IAC: IacArtifact = {
  schemaVersion: "1", kind: "iac",
  compose: { file: "docker-compose.yml", content: "version: '3'" },
  k8s: { manifests: [{
    file: "k8s/svc.yaml", kind: "Service", name: "api",
    content: "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n  namespace: atlas-projects\nspec: {}"
  }] },
  services: [], imageRegistry: { url: "reg.local", namespace: "proj-1" }
};

const DEPLOY: DeployArtifact = {
  schemaVersion: "1", kind: "deploy", target: "k8s",
  argoApplication: {
    file: "argo/app.yaml", name: "proj-1-main", repoUrl: "git@x:y.git", path: "k8s/",
    content: "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec: {}"
  },
  imageBuilds: [
    { serviceName: "api", dockerfilePath: "./svc/api/Dockerfile", imageTag: "reg.local/atlas/api:abc" }
  ],
  smokeTests: []
};

function makeOpts() {
  const kubernetes = new InMemoryKubernetesClient();
  const cloudflare = new InMemoryCloudflareClient();
  return {
    kubernetes, cloudflare,
    branching: {
      ensureBranch: async (_p: string, b: string) => ({ created: true, schemaName: `branch_${b}` }),
      dropBranch: async (_p: string, b: string) => ({ schemaName: `branch_${b}`, dropped: true }),
      listBranches: async () => []
    },
    migrate: async (i: { schemaName: string }) => ({ schemaName: i.schemaName, applied: 0, filenames: [] as string[] }),
    ingressTarget: "ingress.example.com",
    reconcileIntervalMs: 1, reconcileTimeoutMs: 50,
    skipImagePush: true  // default tests don't need real registry
  };
}

const INPUT = {
  projectId: "p-1", branchId: "main", subdomain: "proj-1", apex: "atlas.dev",
  iacArtifact: IAC, deployArtifact: DEPLOY
};

describe("runDeployFromArtifacts — Plan F.4 image build", () => {
  it("attaches imageBuilds when every build succeeds", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const r = await runDeployFromArtifacts({ ...opts, imageRunner }, INPUT);
    expect(r.imageBuilds).toBeDefined();
    expect(r.imageBuilds).toHaveLength(1);
    expect(r.imageBuilds?.[0]?.ok).toBe(true);
    expect(r.imageBuilds?.[0]?.serviceName).toBe("api");
  });

  it("runs the image builder BEFORE applying any k8s manifests", async () => {
    const opts = makeOpts();
    const callOrder: string[] = [];
    const imageRunner: CommandRunner = vi.fn(async (_cmd, args) => {
      callOrder.push(`docker ${args[0]}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const origApply = opts.kubernetes.apply.bind(opts.kubernetes);
    opts.kubernetes.apply = async (ns, kind, name, yaml) => {
      callOrder.push(`k8s.apply ${kind}/${name}`);
      return origApply(ns, kind, name, yaml);
    };
    await runDeployFromArtifacts({ ...opts, imageRunner }, INPUT);
    const firstK8s = callOrder.findIndex((c) => c.startsWith("k8s.apply"));
    const lastDocker = callOrder.map((c, i) => c.startsWith("docker") ? i : -1).filter((i) => i >= 0).pop() ?? -1;
    expect(lastDocker).toBeLessThan(firstK8s);
  });

  it("throws DeployError BEFORE any k8s apply when an image build fails", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "no such file: Dockerfile", exitCode: 1 }));
    let appliedSomething = false;
    opts.kubernetes.apply = async () => { appliedSomething = true; };
    await expect(runDeployFromArtifacts({ ...opts, imageRunner }, INPUT)).rejects.toThrow(/image build.*failed|no such file/i);
    expect(appliedSomething).toBe(false);
  });

  it("skips the builder when imageBuilds is empty (no runner call)", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const r = await runDeployFromArtifacts(
      { ...opts, imageRunner },
      { ...INPUT, deployArtifact: { ...DEPLOY, imageBuilds: [] } }
    );
    expect(imageRunner).not.toHaveBeenCalled();
    expect(r.imageBuilds).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement** in `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`:

Add at the top of the try block, BEFORE the `for (const m of input.iacArtifact.k8s.manifests)` loop:

```ts
// Plan F.4 — build + push every image BEFORE any k8s call. Fail-fast on
// build error: nothing to roll back yet.
let imageResults: ImageBuilderResult[] | undefined;
if (input.deployArtifact.imageBuilds.length > 0) {
  imageResults = await buildAndPushImages(input.deployArtifact.imageBuilds, {
    ...(opts.imageRunner ? { runner: opts.imageRunner } : {}),
    ...(opts.skipImagePush !== undefined ? { skipPush: opts.skipImagePush } : {})
  });
  const failed = imageResults.filter((r) => !r.ok);
  if (failed.length > 0) {
    const detail = failed.map((r) => `${r.serviceName}:${r.imageTag} (${r.error ?? "unknown"})`).join(", ");
    throw new DeployError(`${failed.length} image build(s) failed: ${detail}`);
  }
}
```

Thread `imageResults` into the returned result (alongside `smokeResults`):

```ts
return {
  // ...existing fields...
  ...(imageResults && imageResults.length > 0 ? { imageBuilds: imageResults } : {})
};
```

- [ ] **Step 4:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): build+push images before k8s apply; fail-fast on build error (Plan F.4 Task 2)"
```

---

### Task 3: Real BranchingPort + MigratePort adapters in atlas-web

**Files:**
- Create: `apps/atlas-web/lib/engine/branching.ts`
- Create: `apps/atlas-web/test/lib/engine/branching.test.ts`
- Modify: `apps/atlas-web/lib/engine/factory.ts`

- [ ] **Step 1: Failing test** at `apps/atlas-web/test/lib/engine/branching.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createDeployBranching, createDeployMigrate } from "@/lib/engine/branching";

describe("createDeployBranching", () => {
  it("delegates ensureBranch to PgBranchingAdapter", async () => {
    const ensureBranch = vi.fn(async () => ({ schemaName: "br_deadbeef00000000", created: true }));
    const fakeAdapter = { ensureBranch, dropBranch: vi.fn(), listBranches: vi.fn(async () => []) };
    const port = createDeployBranching(fakeAdapter as never);
    const r = await port.ensureBranch("proj-1", "wf-run-1");
    expect(ensureBranch).toHaveBeenCalledWith("proj-1", "wf-run-1");
    expect(r.created).toBe(true);
    expect(r.schemaName).toMatch(/^br_/);
  });

  it("dropBranch delegates", async () => {
    const dropBranch = vi.fn(async () => ({ schemaName: "br_x", dropped: true }));
    const port = createDeployBranching({ ensureBranch: vi.fn(), dropBranch, listBranches: vi.fn(async () => []) } as never);
    await port.dropBranch("p", "b");
    expect(dropBranch).toHaveBeenCalledWith("p", "b");
  });
});

describe("createDeployMigrate", () => {
  it("calls replayMigrationsToSchema with the configured pool + dir", async () => {
    const replay = vi.fn(async () => ({ schemaName: "br_x", applied: 5, filenames: ["0001.sql"] }));
    const pool = { /* not used by fake replay */ } as never;
    const migrate = createDeployMigrate({ pool, migrationsDir: "/fake/dir", replay });
    const r = await migrate({ schemaName: "br_x" });
    expect(replay).toHaveBeenCalledWith({ pool, schemaName: "br_x", migrationsDir: "/fake/dir" });
    expect(r.applied).toBe(5);
  });
});
```

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** `apps/atlas-web/lib/engine/branching.ts`:

```ts
import type { Pool } from "pg";
import type { BranchingPort, MigratePort } from "@atlas/deploy-orchestrator";

/** Subset of @atlas/postgres-branching's PgBranchingAdapter we actually use.
 *  Declared as a structural interface so unit tests can inject a vi.fn-backed
 *  fake without dragging in the pg dependency. */
export interface BranchingAdapter {
  ensureBranch(projectId: string, branchId: string): Promise<{ schemaName: string; created: boolean }>;
  dropBranch(projectId: string, branchId: string): Promise<{ schemaName: string; dropped: boolean }>;
  listBranches(projectId: string): Promise<string[]>;
}

/** Wraps a BranchingAdapter into the orchestrator's BranchingPort. The two
 *  contracts already match shape-for-shape; this exists so the factory has a
 *  single import + a place to attach future per-run telemetry. */
export function createDeployBranching(adapter: BranchingAdapter): BranchingPort {
  return {
    ensureBranch: (projectId, branchId) => adapter.ensureBranch(projectId, branchId),
    dropBranch: (projectId, branchId) => adapter.dropBranch(projectId, branchId),
    listBranches: (projectId) => adapter.listBranches(projectId)
  };
}

export interface CreateDeployMigrateInput {
  pool: Pool;
  migrationsDir: string;
  /** Injection point for tests. Defaults to the real @atlas/postgres-branching
   *  helper at module load (dynamic import keeps test import side-effect free). */
  replay?: (input: { pool: Pool; schemaName: string; migrationsDir: string }) => Promise<{
    schemaName: string; applied: number; filenames: string[];
  }>;
}

export function createDeployMigrate(input: CreateDeployMigrateInput): MigratePort {
  return async ({ schemaName }) => {
    const replay = input.replay ?? (await import("@atlas/postgres-branching")).replayMigrationsToSchema;
    return replay({ pool: input.pool, schemaName, migrationsDir: input.migrationsDir });
  };
}
```

- [ ] **Step 4: Swap the stubs in `apps/atlas-web/lib/engine/factory.ts`** inside `buildDeployRunner`. Locate the existing `branching` + `migrate` stubs (around line 1080–1100) and replace with:

```ts
const { PgBranchingAdapter } = await import("@atlas/postgres-branching");
const { Pool } = await import("pg");
const { createDeployBranching, createDeployMigrate } = await import("./branching.js");
const { resolve: pathResolve } = await import("node:path");

// DATABASE_URL_DEPLOY lets operators point per-run branches at a separate
// cluster from the main spec-graph-data DB. Falls back to DATABASE_URL.
const deployDbUrl = process.env.DATABASE_URL_DEPLOY ?? process.env.DATABASE_URL;
if (!deployDbUrl) {
  throw new Error(
    "Deploy runtime enabled (ATLAS_FF_DEPLOY_RUNTIME=true) but no DATABASE_URL_DEPLOY or DATABASE_URL set"
  );
}
const deployPool = new Pool({ connectionString: deployDbUrl });
const branchingAdapter = new PgBranchingAdapter(deployPool);
const branching = createDeployBranching(branchingAdapter);
// spec-graph-data ships its drizzle migrations in its package directory. From
// atlas-web's monorepo cwd they resolve under packages/spec-graph-data/drizzle.
const migrationsDir = pathResolve(process.cwd(), "..", "..", "packages", "spec-graph-data", "drizzle");
const migrate = createDeployMigrate({ pool: deployPool, migrationsDir });
```

(Remove the original stub objects + comments noting they're "Plan F.3 territory".)

- [ ] **Step 5:** Run + typecheck + commit:

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web test branching
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
git add apps/atlas-web/lib/engine/branching.ts apps/atlas-web/test/lib/engine/branching.test.ts apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): real per-run Postgres branching + migrate in deploy factory (Plan F.4 Task 3)"
```

---

## Plan F.4 — Self-review checklist

- [ ] Spec §"Image build + push" → Tasks 1, 2
- [ ] Spec §"Real per-run Postgres branching" → Task 3

**Shippable result:** Workflow deploys with `ATLAS_FF_DEPLOY_RUNTIME=true` now build + push every image BEFORE applying k8s (fail-fast on build error; no rollback needed). Per-run Postgres schemas are real (one per workflowRunId+branchId), migrated from the canonical spec-graph-data drizzle directory. GitOps repo push + OpenStack-specific manifests remain deferred to Plan F.5.
