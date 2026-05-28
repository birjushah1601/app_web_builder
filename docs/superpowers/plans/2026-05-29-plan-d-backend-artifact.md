# Plan D — Backend Artifact Kind + Typed Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow node with `artifactKind: "backend-rest-api"` produce a typed `BackendArtifact`, pass a real Python build gate (pyright), and surface live Swagger UI in the canvas — replacing the Plan C `BackendStubCanvas`. Unstub the workflow engine's `awaitRitual` along the way so this and every future artifact kind has a real typed-handoff path.

**Architecture:** Adds one Zod schema (`BackendArtifactSchema`), one new role (`BackendArtifactRole`), one new canvas renderer (`BackendCanvas`). Reuses the existing `ritual.artifact_emitted` event for handoff and the existing `gate-build` registry for the Python build gate (atlas-fastapi → pyright is already wired in `BUILD_COMMANDS`). The engine's `makeAwaitRitual()` stub becomes a real implementation that polls `ritualEngine.getRitual()`, scans `roleEvents` for `ritual.artifact_emitted`, and validates the payload against the `ArtifactContractRegistry` keyed by the workflow node's `artifactKind`.

**Tech Stack:** TypeScript pnpm monorepo, Zod 3.23, vitest, `@xyflow/react`-mounted canvas, FastAPI's auto-served `/docs` + `/openapi.json`, pyright, ruff.

**Spec reference:** `docs/superpowers/specs/2026-05-29-plan-d-backend-artifact-design.md`

**Depends on:** Plans A + B + C merged. Branch off current `main` (`d05907a`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts` | `BackendArtifactSchema` Zod schema + registration into `ArtifactContractRegistry` |
| `packages/workflow-engine/test/artifact-contracts/backend-rest-api.test.ts` | Schema happy/sad paths |
| `packages/workflow-engine/test/engine-await-ritual.test.ts` | awaitRitual unit tests (polling, event extraction, validation, fallback) |
| `packages/workflow-engine/test/integration-backend-handoff.test.ts` | End-to-end: fake ritual emits real BackendArtifact event → engine persists validated artifact → downstream node sees it in `priorArtifact.upstream` |
| `packages/role-developer/src/backend-artifact/build-artifact.ts` | Pure helper `buildBackendArtifact(openApiSpec, envContract, sandboxInfo)` |
| `packages/role-developer/test/backend-artifact/build-artifact.test.ts` | Helper unit tests |
| `packages/role-developer/src/backend-artifact/role.ts` | `BackendArtifactRole implements Role` — fetches `/openapi.json`, calls helper, emits `ritual.artifact_emitted` event |
| `packages/role-developer/test/backend-artifact/role.test.ts` | Role unit tests with stubbed fetch |
| `apps/atlas-web/components/canvas/renderers/BackendCanvas.tsx` | Real Swagger UI iframe; replaces `BackendStubCanvas` |
| `apps/atlas-web/test/components/canvas/renderers/BackendCanvas.test.tsx` | Renderer tests |

### Modified files
| File | Change |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/index.ts` | Side-effect import of `./backend-rest-api.js` so the registration runs at module load |
| `packages/workflow-engine/src/engine.ts` | Replace `makeAwaitRitual()` stub with the real polling + event-scan + validation implementation; thread the node's `artifactKind` through the `awaitRitual` caller |
| `packages/sandbox-e2b/templates/atlas-fastapi/pyproject.toml` | Add `pyright>=1.1.388` to `[dependency-groups].dev` |
| `packages/ritual-engine/src/engine.ts` | When the active ritual targets `atlas-fastapi` AND the BuildGateRole pass succeeds, dispatch `BackendArtifactRole` as the next post-developer chain entry |
| `apps/atlas-web/components/canvas/register-renderers.tsx` | Register `BackendCanvas` against the `swagger` mode ID (replacing `BackendStubCanvas`); delete the stub import |

### Deleted files
| File | Reason |
|---|---|
| `apps/atlas-web/components/canvas/renderers/BackendStubCanvas.tsx` | Replaced by `BackendCanvas` |

---

## Tasks

### Task 1: BackendArtifactSchema + registry registration

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts`
- Create: `packages/workflow-engine/test/artifact-contracts/backend-rest-api.test.ts`
- Modify: `packages/workflow-engine/src/artifact-contracts/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/workflow-engine/test/artifact-contracts/backend-rest-api.test.ts
import { describe, it, expect } from "vitest";
import { BackendArtifactSchema } from "../../src/artifact-contracts/backend-rest-api.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/index.js";

describe("BackendArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "backend-rest-api" as const,
    openApiSpec: { openapi: "3.1.0", paths: {} },
    routes: [{ method: "get", path: "/health" }],
    envContract: [],
    sandboxId: "sb-1",
    previewUrl: "https://example.com"
  };

  it("accepts a minimal valid artifact", () => {
    const r = BackendArtifactSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects a wrong kind literal", () => {
    const r = BackendArtifactSchema.safeParse({ ...valid, kind: "frontend-app" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL previewUrl", () => {
    const r = BackendArtifactSchema.safeParse({ ...valid, previewUrl: "not a url" });
    expect(r.success).toBe(false);
  });

  it("accepts optional dbDdl + envContract entries", () => {
    const r = BackendArtifactSchema.safeParse({
      ...valid,
      dbDdl: "CREATE TABLE x ()",
      envContract: [{ name: "FOO", required: true, description: "x" }]
    });
    expect(r.success).toBe(true);
  });

  it("is registered against the kind 'backend-rest-api' in ArtifactContractRegistry", () => {
    expect(ArtifactContractRegistry.has("backend-rest-api")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
pnpm -F @atlas/workflow-engine test backend-rest-api
```
Expected: FAIL — module `../../src/artifact-contracts/backend-rest-api.js` not found.

- [ ] **Step 3: Implement schema + registration**

```ts
// packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts
import { z } from "zod";
import { ArtifactContractRegistry } from "./index.js";

export const BackendArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-rest-api"),
  openApiSpec: z.record(z.unknown()),
  routes: z.array(
    z.object({
      method: z.enum(["get", "post", "put", "patch", "delete", "head", "options"]),
      path: z.string().min(1),
      opId: z.string().optional(),
      requestSchema: z.record(z.unknown()).optional(),
      responseSchema: z.record(z.unknown()).optional()
    })
  ),
  dbDdl: z.string().optional(),
  envContract: z.array(
    z.object({
      name: z.string().min(1),
      required: z.boolean(),
      description: z.string().optional()
    })
  ),
  sandboxId: z.string().min(1),
  previewUrl: z.string().url().optional()
});

export type BackendArtifact = z.infer<typeof BackendArtifactSchema>;

ArtifactContractRegistry.register("backend-rest-api", BackendArtifactSchema);
```

- [ ] **Step 4: Make registration fire at module load**

```ts
// packages/workflow-engine/src/artifact-contracts/index.ts
// (append at the bottom of the existing file, AFTER the Registry export)
import "./backend-rest-api.js";
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
pnpm -F @atlas/workflow-engine test backend-rest-api
```
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts \
        packages/workflow-engine/src/artifact-contracts/index.ts \
        packages/workflow-engine/test/artifact-contracts/backend-rest-api.test.ts
git commit -m "feat(workflow-engine): BackendArtifact Zod schema + registry registration (Plan D Task 1)"
```

---

### Task 2: awaitRitual unstub (real polling + event extraction + validation)

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts`
- Create: `packages/workflow-engine/test/engine-await-ritual.test.ts`

The current `makeAwaitRitual()` is a Plan A stub returning `{ kind: "generic", payload: { nodeId } }` regardless of what happened. Replace it with a real implementation that polls `ritualEngine.getRitual()` until terminal state, scans `roleEvents` for `ritual.artifact_emitted`, validates the payload, and returns it. The expected `artifactKind` comes from the workflow node, not the event — keeping the event schema unchanged.

- [ ] **Step 1: Write failing test**

```ts
// packages/workflow-engine/test/engine-await-ritual.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine } from "../src/engine.js";
import "../src/artifact-contracts/backend-rest-api.js"; // ensures registry has the kind

// _awaitRitualForTesting is a thin test-only seam exported from engine.ts
// (added in Step 3). It exposes the same implementation awaitRitual uses
// internally without forcing a workflow to be started.
import { _awaitRitualForTesting } from "../src/engine.js";

function makeRitualEngine(
  states: Array<{ state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>
) {
  let i = 0;
  return {
    async start() { return "ritual-1"; },
    async getRitual() {
      const s = states[Math.min(i, states.length - 1)]!;
      i++;
      return s;
    },
    async abort() {}
  };
}

const VALID_BACKEND = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: { openapi: "3.1.0", paths: {} },
  routes: [],
  envContract: [],
  sandboxId: "sb-1"
};

describe("awaitRitual (Plan D)", () => {
  it("returns the validated artifact when the ritual completes with a matching event", async () => {
    const re = makeRitualEngine([
      { state: "running", roleEvents: [] },
      {
        state: "completed",
        roleEvents: [
          { eventType: "ritual.artifact_emitted", payload: { fromRole: "backend-artifact", artifact: VALID_BACKEND } }
        ]
      }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("unreachable");
    expect(result.artifactKind).toBe("backend-rest-api");
    expect((result.artifact as { kind: string }).kind).toBe("backend-rest-api");
  });

  it("falls back to a synthesized generic artifact when no event was emitted", async () => {
    const re = makeRitualEngine([
      { state: "completed", roleEvents: [] }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "frontend-app", { pollMs: 1 });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("unreachable");
    expect(result.artifactKind).toBe("generic");
    expect((result.artifact as { kind: string }).kind).toBe("generic");
  });

  it("rejects with kind=failed when the ritual ends in failed state", async () => {
    const re = makeRitualEngine([{ state: "failed", roleEvents: [] }]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("failed");
  });

  it("rejects with kind=failed when the emitted artifact fails schema validation", async () => {
    const re = makeRitualEngine([
      {
        state: "completed",
        roleEvents: [
          { eventType: "ritual.artifact_emitted", payload: { fromRole: "x", artifact: { kind: "backend-rest-api", schemaVersion: "1" } } }
        ]
      }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("failed");
  });

  it("returns failed with a timeout error when getRitual never reaches terminal state", async () => {
    const re = makeRitualEngine([{ state: "running", roleEvents: [] }]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1, timeoutMs: 20 });
    expect(result.kind).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
pnpm -F @atlas/workflow-engine test engine-await-ritual
```
Expected: FAIL — `_awaitRitualForTesting` not exported.

- [ ] **Step 3: Replace `makeAwaitRitual` in `packages/workflow-engine/src/engine.ts`**

Locate the existing `private makeAwaitRitual() { … stub … }` (currently around lines 581-600 — confirm via `grep -n makeAwaitRitual packages/workflow-engine/src/engine.ts` because line numbers drift). Replace its body and export a test seam at module scope:

```ts
// Add near the top imports of engine.ts:
import { ArtifactContractRegistry, GenericArtifactSchema } from "./artifact-contracts/index.js";

// (still inside engine.ts, replace the existing makeAwaitRitual method body)
private makeAwaitRitual() {
  return (ritualId: string, expectedKind: string) =>
    awaitRitualImpl(this.opts.ritualEngine, ritualId, expectedKind, {});
}

// Export a module-scope implementation so tests can drive it without
// constructing a full WorkflowEngine.
export interface AwaitRitualOptions {
  pollMs?: number;     // poll interval; default 250
  timeoutMs?: number;  // hard cap; default 30 minutes
}

export type AwaitRitualResult =
  | { kind: "done"; artifact: unknown; artifactKind: string }
  | { kind: "failed"; error: string };

async function awaitRitualImpl(
  ritualEngine: IRitualEngine,
  ritualId: string,
  expectedKind: string,
  opts: AwaitRitualOptions
): Promise<AwaitRitualResult> {
  const pollMs = opts.pollMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  let snapshot: Awaited<ReturnType<IRitualEngine["getRitual"]>> | undefined;
  while (Date.now() < deadline) {
    snapshot = await ritualEngine.getRitual(ritualId);
    if (snapshot && (snapshot.state === "completed" || snapshot.state === "failed" || snapshot.state === "aborted")) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (!snapshot || (snapshot.state !== "completed" && snapshot.state !== "failed" && snapshot.state !== "aborted")) {
    return { kind: "failed", error: `awaitRitual timed out after ${timeoutMs}ms` };
  }
  if (snapshot.state === "failed" || snapshot.state === "aborted") {
    return { kind: "failed", error: `ritual ended in state "${snapshot.state}"` };
  }

  // Scan roleEvents newest-first for ritual.artifact_emitted.
  for (let i = snapshot.roleEvents.length - 1; i >= 0; i--) {
    const ev = snapshot.roleEvents[i];
    if (!ev || ev.eventType !== "ritual.artifact_emitted") continue;
    const payload = ev.payload as { artifact?: unknown } | null | undefined;
    const artifact = payload?.artifact;
    const schema = ArtifactContractRegistry.get(expectedKind);
    if (!schema) {
      // Unknown kind in the registry — best-effort: try generic
      const parsed = GenericArtifactSchema.safeParse(artifact);
      if (!parsed.success) {
        return { kind: "failed", error: `emitted artifact failed generic validation: ${parsed.error.message}` };
      }
      return { kind: "done", artifact: parsed.data, artifactKind: "generic" };
    }
    const parsed = schema.safeParse(artifact);
    if (!parsed.success) {
      return { kind: "failed", error: `emitted artifact failed "${expectedKind}" validation: ${parsed.error.message}` };
    }
    return { kind: "done", artifact: parsed.data, artifactKind: expectedKind };
  }

  // No artifact event — synthesize a generic placeholder (preserves Plan A behaviour).
  return {
    kind: "done",
    artifact: { schemaVersion: "1", kind: "generic", payload: {} },
    artifactKind: "generic"
  };
}

// Test seam.
export const _awaitRitualForTesting = awaitRitualImpl;
```

- [ ] **Step 4: Thread the workflow node's `artifactKind` into the awaitRitual call**

In the same `engine.ts`, the scheduler currently calls `awaitRitual(ritualId)` with one argument. Find the call site(s) — typically inside the scheduler config passed to `new WorkflowScheduler({...})` — and pass the node's `artifactKind`. The scheduler interface (`packages/workflow-engine/src/scheduler.ts`) may need a small signature change:

```ts
// scheduler.ts — change the awaitRitual callback type:
awaitRitual: (ritualId: string, artifactKind: string) => Promise<AwaitRitualResult>;
```

And inside the scheduler, where it currently calls `awaitRitual(ritualId)`, change to `awaitRitual(ritualId, node.artifactKind)`.

(Search for `awaitRitual(` to find every call site; update each.)

- [ ] **Step 5: Run all workflow-engine tests, confirm green**

```bash
pnpm -F @atlas/workflow-engine test
```
Expected: ALL PASS including the 5 new awaitRitual tests + the existing 91.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-engine/src/engine.ts \
        packages/workflow-engine/src/scheduler.ts \
        packages/workflow-engine/test/engine-await-ritual.test.ts
git commit -m "feat(workflow-engine): real awaitRitual — poll, scan ritual.artifact_emitted, validate via registry (Plan D Task 2)"
```

---

### Task 3: Add pyright to atlas-fastapi template

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-fastapi/pyproject.toml`

`gate-build`'s `BUILD_COMMANDS["atlas-fastapi"]` already runs `python -m pyright --outputjson .` against the sandbox, but the template's pyproject.toml currently only ships ruff + pytest. Without pyright in the venv, the build gate command exits non-zero with "module not found" — appearing as a "build gate failed" verdict regardless of actual code quality.

- [ ] **Step 1: Add pyright to dev deps**

```toml
# packages/sandbox-e2b/templates/atlas-fastapi/pyproject.toml
# Inside [dependency-groups].dev, append pyright:
[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "ruff>=0.7",
    "pyright>=1.1.388",
]
```

- [ ] **Step 2: Smoke-test locally (no E2B credit)**

```bash
cd packages/sandbox-e2b/templates/atlas-fastapi
uv sync
uv run pyright --version
# Expected: "pyright 1.1.x" prints
uv run pyright --outputjson app/ | head -20
# Expected: JSON output with "generalDiagnostics" key (possibly empty array)
```

If pyright complains about the existing template files, fix them inline so the new dep doesn't trip on the very next gate run.

- [ ] **Step 3: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-fastapi/pyproject.toml
git commit -m "feat(sandbox-e2b): add pyright to atlas-fastapi dev deps so the build gate runs (Plan D Task 3)

The atlas-fastapi build gate command runs 'python -m pyright --outputjson .'
but pyright was never in the template image. With this change, the E2B
image rebuild (run scripts/build-template.sh and update e2b.toml's
template_id) will ship a working build gate for backend rituals."
```

NOTE: Rebuilding the E2B template is a manual one-off step the user runs against the E2B API; the plan does not automate it. After rebuilding, update `packages/sandbox-e2b/templates/atlas-fastapi/e2b.toml` with the new template_id and commit that separately.

---

### Task 4: `buildBackendArtifact` pure helper

**Files:**
- Create: `packages/role-developer/src/backend-artifact/build-artifact.ts`
- Create: `packages/role-developer/test/backend-artifact/build-artifact.test.ts`

Pure function: given an OpenAPI 3.1 JSON doc + an envContract array + sandbox info, returns a `BackendArtifact` ready to validate. No I/O. Easy to unit-test against fixtures.

- [ ] **Step 1: Write failing test**

```ts
// packages/role-developer/test/backend-artifact/build-artifact.test.ts
import { describe, it, expect } from "vitest";
import { buildBackendArtifact } from "../../src/backend-artifact/build-artifact.js";

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "demo", version: "0.0.1" },
  paths: {
    "/health": {
      get: { operationId: "get_health", responses: { "200": { description: "ok" } } }
    },
    "/items": {
      post: {
        operationId: "create_item",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "created", content: { "application/json": { schema: { type: "object" } } } } }
      }
    }
  }
};

describe("buildBackendArtifact", () => {
  it("derives routes from the OpenAPI paths object", () => {
    const a = buildBackendArtifact({
      openApiSpec: OPENAPI,
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.kind).toBe("backend-rest-api");
    expect(a.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "get", path: "/health", opId: "get_health" }),
        expect.objectContaining({ method: "post", path: "/items", opId: "create_item" })
      ])
    );
  });

  it("threads previewUrl + envContract + dbDdl through verbatim", () => {
    const a = buildBackendArtifact({
      openApiSpec: OPENAPI,
      envContract: [{ name: "DATABASE_URL", required: true, description: "Postgres URL" }],
      sandboxId: "sb-1",
      previewUrl: "https://sb-1.preview.e2b.dev",
      dbDdl: "CREATE TABLE items (id SERIAL PRIMARY KEY)"
    });
    expect(a.previewUrl).toBe("https://sb-1.preview.e2b.dev");
    expect(a.envContract).toHaveLength(1);
    expect(a.dbDdl).toContain("CREATE TABLE items");
  });

  it("handles an empty paths object as zero routes", () => {
    const a = buildBackendArtifact({
      openApiSpec: { openapi: "3.1.0", paths: {} },
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.routes).toEqual([]);
  });

  it("ignores non-HTTP-verb keys (parameters, summary) on a path item", () => {
    const a = buildBackendArtifact({
      openApiSpec: {
        openapi: "3.1.0",
        paths: {
          "/x": {
            summary: "ignored",
            parameters: [],
            get: { operationId: "x_get", responses: { "200": { description: "" } } }
          }
        }
      },
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.routes).toHaveLength(1);
    expect(a.routes[0]?.method).toBe("get");
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm -F @atlas/role-developer test build-artifact
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

```ts
// packages/role-developer/src/backend-artifact/build-artifact.ts
import type { BackendArtifact } from "@atlas/workflow-engine";

const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options"
] as const);

export interface BuildBackendArtifactInput {
  openApiSpec: Record<string, unknown>;
  envContract: BackendArtifact["envContract"];
  sandboxId: string;
  previewUrl?: string;
  dbDdl?: string;
}

export function buildBackendArtifact(input: BuildBackendArtifactInput): BackendArtifact {
  const routes: BackendArtifact["routes"] = [];
  const paths = (input.openApiSpec.paths ?? {}) as Record<string, unknown>;
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const [maybeMethod, op] of Object.entries(item as Record<string, unknown>)) {
      const method = maybeMethod.toLowerCase();
      if (!HTTP_METHODS.has(method as never)) continue;
      const opObj = (op ?? {}) as {
        operationId?: unknown;
        requestBody?: { content?: Record<string, { schema?: unknown }> };
        responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
      };
      const requestSchema = pickJsonSchema(opObj.requestBody?.content);
      const successResponse = Object.entries(opObj.responses ?? {})
        .find(([code]) => code.startsWith("2"))?.[1];
      const responseSchema = pickJsonSchema(successResponse?.content);
      routes.push({
        method: method as BackendArtifact["routes"][number]["method"],
        path,
        ...(typeof opObj.operationId === "string" && { opId: opObj.operationId }),
        ...(requestSchema && { requestSchema }),
        ...(responseSchema && { responseSchema })
      });
    }
  }

  return {
    schemaVersion: "1",
    kind: "backend-rest-api",
    openApiSpec: input.openApiSpec,
    routes,
    envContract: input.envContract,
    sandboxId: input.sandboxId,
    ...(input.previewUrl && { previewUrl: input.previewUrl }),
    ...(input.dbDdl && { dbDdl: input.dbDdl })
  };
}

function pickJsonSchema(
  content: Record<string, { schema?: unknown }> | undefined
): Record<string, unknown> | undefined {
  if (!content) return undefined;
  const json = content["application/json"]?.schema;
  if (!json || typeof json !== "object") return undefined;
  return json as Record<string, unknown>;
}
```

NOTE: `@atlas/role-developer` must add `@atlas/workflow-engine` to its `dependencies` in `package.json` if it isn't already (check first; the import requires the workspace link). If absent, add it and re-run `pnpm install` from the repo root.

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm -F @atlas/role-developer test build-artifact
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/role-developer/src/backend-artifact/build-artifact.ts \
        packages/role-developer/test/backend-artifact/build-artifact.test.ts \
        packages/role-developer/package.json
git commit -m "feat(role-developer): buildBackendArtifact pure helper (Plan D Task 4)"
```

---

### Task 5: `BackendArtifactRole`

**Files:**
- Create: `packages/role-developer/src/backend-artifact/role.ts`
- Create: `packages/role-developer/test/backend-artifact/role.test.ts`
- Modify: `packages/role-developer/src/index.ts` — export the new role

A `Role` (per `@atlas/conductor`) that:
1. Reads `sandboxId` + `previewUrl` from `RoleInvocation.priorArtifact` (the ritual-engine threads sandbox info there in the post-developer chain).
2. Waits for `/health` to return 200.
3. Fetches `/openapi.json`.
4. Constructs the `BackendArtifact` via `buildBackendArtifact`.
5. Emits a `ritual.artifact_emitted` event in its `RoleOutput.events` with `{ fromRole: "backend-artifact", artifact }`.

- [ ] **Step 1: Write failing test**

```ts
// packages/role-developer/test/backend-artifact/role.test.ts
import { describe, it, expect, vi } from "vitest";
import { BackendArtifactRole } from "../../src/backend-artifact/role.js";

const OPENAPI = {
  openapi: "3.1.0",
  paths: { "/health": { get: { operationId: "h", responses: { "200": { description: "ok" } } } } }
};

function makeFetcher(map: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const m = map[url];
    if (!m) throw new Error(`unmocked fetch: ${url}`);
    return new Response(JSON.stringify(m.body), { status: m.status });
  });
}

describe("BackendArtifactRole", () => {
  it("emits a ritual.artifact_emitted event with a validated BackendArtifact", async () => {
    const fetcher = makeFetcher({
      "https://sb-1.preview/health": { status: 200, body: { status: "ok" } },
      "https://sb-1.preview/openapi.json": { status: 200, body: OPENAPI }
    });
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 50, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1", previewUrl: "https://sb-1.preview" }
    });
    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; routes: unknown[] } }).artifact;
    expect(artifact.kind).toBe("backend-rest-api");
    expect(artifact.routes).toHaveLength(1);
    expect(out.diff.kind).toBe("none");
  });

  it("retries /health until it returns 200", async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        calls++;
        if (calls < 3) return new Response("", { status: 502 });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response(JSON.stringify(OPENAPI), { status: 200 });
    });
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 200, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1", previewUrl: "https://sb-1.preview" }
    });
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("emits a failure event when previewUrl is missing", async () => {
    const fetcher = vi.fn();
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 50, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1" }
    });
    expect(out.events.some((e) => e.eventType === "backend-artifact.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm -F @atlas/role-developer test backend-artifact/role
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement role**

```ts
// packages/role-developer/src/backend-artifact/role.ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { buildBackendArtifact } from "./build-artifact.js";
import { BackendArtifactSchema } from "@atlas/workflow-engine";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface BackendArtifactRoleOptions {
  /** Injected so tests don't hit the network. Defaults to global fetch. */
  fetcher?: Fetcher;
  readinessTimeoutMs?: number; // default 30s
  readinessPollMs?: number;    // default 500ms
}

interface PriorShape {
  sandboxId?: unknown;
  previewUrl?: unknown;
  envContract?: unknown;
  dbDdl?: unknown;
}

export class BackendArtifactRole implements Role {
  readonly id = "backend-artifact";
  private readonly fetcher: Fetcher;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;

  constructor(opts: BackendArtifactRoleOptions = {}) {
    this.fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
    this.readinessTimeoutMs = opts.readinessTimeoutMs ?? 30_000;
    this.readinessPollMs = opts.readinessPollMs ?? 500;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const prior = (inv.priorArtifact ?? {}) as PriorShape;
    const sandboxId = typeof prior.sandboxId === "string" ? prior.sandboxId : undefined;
    const previewUrl = typeof prior.previewUrl === "string" ? prior.previewUrl : undefined;
    const envContract = Array.isArray(prior.envContract) ? (prior.envContract as never) : [];
    const dbDdl = typeof prior.dbDdl === "string" ? prior.dbDdl : undefined;

    if (!sandboxId || !previewUrl) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: "missing sandboxId or previewUrl in priorArtifact" }
      });
      return { events, diff: { kind: "none" } };
    }

    // Wait for /health.
    const deadline = Date.now() + this.readinessTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await this.fetcher(`${previewUrl}/health`);
        if (res.ok) { ready = true; break; }
      } catch {
        // network blip — retry
      }
      await new Promise((r) => setTimeout(r, this.readinessPollMs));
    }
    if (!ready) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `/health never returned 200 within ${this.readinessTimeoutMs}ms` }
      });
      return { events, diff: { kind: "none" } };
    }

    // Fetch the OpenAPI spec.
    let openApiSpec: Record<string, unknown>;
    try {
      const res = await this.fetcher(`${previewUrl}/openapi.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      openApiSpec = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `openapi.json fetch failed: ${err instanceof Error ? err.message : String(err)}` }
      });
      return { events, diff: { kind: "none" } };
    }

    // Build + validate.
    const artifact = buildBackendArtifact({
      openApiSpec,
      envContract,
      sandboxId,
      previewUrl,
      ...(dbDdl && { dbDdl })
    });
    const parsed = BackendArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `artifact failed schema validation: ${parsed.error.message}` }
      });
      return { events, diff: { kind: "none" } };
    }

    events.push({
      eventType: "ritual.artifact_emitted",
      payload: { fromRole: "backend-artifact", artifact: parsed.data }
    });
    return { events, diff: { kind: "none" } };
  }
}
```

Verify `@atlas/workflow-engine` is in `packages/role-developer/package.json` deps (added in Task 4) and that `BackendArtifactSchema` is exported from `@atlas/workflow-engine`'s index. If not, add the export:

```ts
// packages/workflow-engine/src/index.ts (if missing)
export { BackendArtifactSchema, type BackendArtifact } from "./artifact-contracts/backend-rest-api.js";
```

- [ ] **Step 4: Export from role-developer's index**

```ts
// packages/role-developer/src/index.ts — append:
export { BackendArtifactRole } from "./backend-artifact/role.js";
export { buildBackendArtifact } from "./backend-artifact/build-artifact.js";
```

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm -F @atlas/role-developer test backend-artifact
```
Expected: PASS — 3 tests + the 4 from Task 4 = 7.

- [ ] **Step 6: Commit**

```bash
git add packages/role-developer/src/backend-artifact/role.ts \
        packages/role-developer/src/index.ts \
        packages/role-developer/test/backend-artifact/role.test.ts \
        packages/workflow-engine/src/index.ts
git commit -m "feat(role-developer): BackendArtifactRole emits typed artifact via ritual event (Plan D Task 5)"
```

---

### Task 6: Wire `BackendArtifactRole` into the ritual-engine post-developer chain

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Modify: atlas-web's factory (where the ritual-engine + roles are constructed) — likely `apps/atlas-web/lib/engine/factory.ts`

The ritual-engine's `postDeveloperChain` (an ordered list of role IDs, see `EngineOptions` around line 36 of `packages/ritual-engine/src/engine.ts`) is the hook. Today factory.ts wires `["build-gate"]` (or similar) for frontend rituals. Plan D extends this so backend rituals also dispatch `backend-artifact` after the build-gate succeeds.

- [ ] **Step 1: Locate the postDeveloperChain construction site**

```bash
grep -rn "postDeveloperChain" apps/atlas-web packages/ritual-engine 2>&1
```
Expected: a few hits, including the `apps/atlas-web/lib/engine/factory.ts` (or similar) where the chain array is passed in.

- [ ] **Step 2: Make the chain conditional on the active sandbox template**

The chain depends on the ritual's target template (resolved from `artifactKind` via `template-router.ts`). The factory should:

```ts
// inside the factory where postDeveloperChain is built:
function buildPostDeveloperChain(targetTemplate: string): string[] {
  const chain = ["build-gate"];
  if (targetTemplate === "atlas-fastapi") chain.push("backend-artifact");
  return chain;
}
```

If `postDeveloperChain` is currently a static array (not derived per-ritual), the factory needs a small refactor to build it per-ritual based on the resolved template. Add a per-ritual hook on the ritual-engine options OR pass a function `getPostDeveloperChain(template: string): string[]` instead of a fixed array.

- [ ] **Step 3: Register `BackendArtifactRole` in the conductor's role registry**

```ts
// inside the factory, after constructing roles:
const backendArtifactRole = new BackendArtifactRole();
conductor.registerRole(backendArtifactRole);
```

(The exact `conductor.registerRole` call shape lives in `packages/conductor/src/conductor.ts` — verify the API. If the conductor uses a constructor `roles` array, add the new role there instead.)

- [ ] **Step 4: Unit test the chain selection**

If the chain selector is a pure function, unit-test it:

```ts
// apps/atlas-web/test/lib/engine/post-developer-chain.test.ts
import { describe, it, expect } from "vitest";
import { buildPostDeveloperChain } from "@/lib/engine/post-developer-chain";

describe("buildPostDeveloperChain", () => {
  it("appends backend-artifact for atlas-fastapi", () => {
    expect(buildPostDeveloperChain("atlas-fastapi")).toEqual(["build-gate", "backend-artifact"]);
  });
  it("does not append backend-artifact for atlas-next-ts-v2", () => {
    expect(buildPostDeveloperChain("atlas-next-ts-v2")).toEqual(["build-gate"]);
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter atlas-web typecheck
pnpm --filter atlas-web test post-developer-chain
pnpm -F @atlas/ritual-engine test
git add apps/atlas-web/lib/engine packages/ritual-engine/src/engine.ts apps/atlas-web/test/lib/engine
git commit -m "feat(atlas-web,ritual-engine): wire BackendArtifactRole into post-developer chain for atlas-fastapi (Plan D Task 6)"
```

---

### Task 7: `BackendCanvas` component (real Swagger UI)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/BackendCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/BackendCanvas.test.tsx`

Renders `<iframe src={previewUrl}/docs />` with a header strip (URL + copy-curl button) and an error overlay for missing/unreachable previewUrl. Reads `BackendArtifact` from the workflow node's `artifact` field for the curl example so it works even when the iframe is loading.

- [ ] **Step 1: Write failing test**

```tsx
// apps/atlas-web/test/components/canvas/renderers/BackendCanvas.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BackendCanvas } from "@/components/canvas/renderers/BackendCanvas";

const ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: { openapi: "3.1.0", paths: {} },
  routes: [{ method: "get" as const, path: "/health", opId: "get_health" }],
  envContract: [],
  sandboxId: "sb-1",
  previewUrl: "https://sb-1.preview"
};

describe("BackendCanvas", () => {
  it("renders an iframe pointed at {previewUrl}/docs", () => {
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={ARTIFACT.previewUrl} />);
    const iframe = screen.getByTestId("backend-swagger-iframe");
    expect(iframe).toHaveAttribute("src", "https://sb-1.preview/docs");
  });

  it("shows the error overlay when previewUrl is undefined", () => {
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={undefined} />);
    expect(screen.getByTestId("backend-canvas-no-preview")).toBeInTheDocument();
  });

  it("copy-curl button writes a curl command for the first route to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={ARTIFACT.previewUrl} />);
    fireEvent.click(screen.getByTestId("backend-copy-curl"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("curl"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://sb-1.preview/health"));
  });

  it("disables copy-curl when there are no routes", () => {
    render(<BackendCanvas artifact={{ ...ARTIFACT, routes: [] }} previewUrl={ARTIFACT.previewUrl} />);
    expect(screen.getByTestId("backend-copy-curl")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm --filter atlas-web test BackendCanvas
```
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component**

```tsx
// apps/atlas-web/components/canvas/renderers/BackendCanvas.tsx
"use client";

import type { BackendArtifact } from "@atlas/workflow-engine";

export interface BackendCanvasProps {
  artifact?: BackendArtifact;
  previewUrl?: string;
}

export function BackendCanvas({ artifact, previewUrl }: BackendCanvasProps) {
  const firstRoute = artifact?.routes[0];

  const onCopyCurl = async () => {
    if (!firstRoute || !previewUrl) return;
    const cmd = `curl -X ${firstRoute.method.toUpperCase()} ${previewUrl}${firstRoute.path}`;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // best-effort; ignore
    }
  };

  if (!previewUrl) {
    return (
      <div
        data-testid="backend-canvas-no-preview"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
      >
        Backend preview URL not yet available. Waiting for the ritual to provision the sandbox…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-mono text-slate-700">{previewUrl}</span>
        <button
          type="button"
          data-testid="backend-copy-curl"
          onClick={onCopyCurl}
          disabled={!firstRoute}
          className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          Copy curl example
        </button>
      </header>
      <iframe
        data-testid="backend-swagger-iframe"
        src={`${previewUrl}/docs`}
        className="h-full w-full border-0"
        title="Swagger UI"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter atlas-web typecheck
pnpm --filter atlas-web test BackendCanvas
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/canvas/renderers/BackendCanvas.tsx \
        apps/atlas-web/test/components/canvas/renderers/BackendCanvas.test.tsx
git commit -m "feat(atlas-web): BackendCanvas — live Swagger UI iframe + copy-curl (Plan D Task 7)"
```

---

### Task 8: Swap the stub renderer for the real one

**Files:**
- Modify: `apps/atlas-web/components/canvas/register-renderers.tsx`
- Delete: `apps/atlas-web/components/canvas/renderers/BackendStubCanvas.tsx`

- [ ] **Step 1: Update register-renderers**

```tsx
// apps/atlas-web/components/canvas/register-renderers.tsx
// Replace this line:
//   import { BackendStubCanvas } from "./renderers/BackendStubCanvas";
// with:
import { BackendCanvas } from "./renderers/BackendCanvas";

// And replace the registration line:
//   canvasModeRegistry.register("swagger", BackendStubCanvas as React.ComponentType<unknown>);
// with:
canvasModeRegistry.register("swagger", BackendCanvas as React.ComponentType<unknown>);
```

- [ ] **Step 2: Delete the stub file**

```bash
rm apps/atlas-web/components/canvas/renderers/BackendStubCanvas.tsx
```

- [ ] **Step 3: Confirm the existing register-renderers test still passes**

(That test, `apps/atlas-web/test/components/canvas/register-renderers.test.tsx`, only checks that `swagger` is registered — not which component. So it should keep passing.)

```bash
pnpm --filter atlas-web typecheck
pnpm --filter atlas-web test register-renderers
```
Expected: PASS — 2 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/components/canvas/register-renderers.tsx \
        apps/atlas-web/components/canvas/renderers/BackendStubCanvas.tsx
git commit -m "feat(atlas-web): swap BackendStubCanvas for real BackendCanvas (Plan D Task 8)"
```

---

### Task 9: End-to-end integration test — typed handoff over a fake ritual engine

**Files:**
- Create: `packages/workflow-engine/test/integration-backend-handoff.test.ts`

Drives the whole chain in-process: a fake `IRitualEngine` whose `getRitual` returns a snapshot containing the `ritual.artifact_emitted` event payload that `BackendArtifactRole` would have emitted. Asserts WorkflowEngine persists the validated artifact AND a downstream node sees it in `priorArtifact.upstream[backendNodeId]`.

- [ ] **Step 1: Write the integration test**

```ts
// packages/workflow-engine/test/integration-backend-handoff.test.ts
import { describe, it, expect } from "vitest";
import { WorkflowEngine, type IRitualEngine } from "../src/engine.js";
import "../src/artifact-contracts/backend-rest-api.js";

// In-memory repo stubs reused from engine.test.ts — copy or extract via
// a small fixtures helper. For brevity here, this test calls
// engine.start(...) with a hand-crafted snapshot that has TWO nodes,
// the second declaring consumes:[firstId].

// (paste/import the makeRunRepo, makeNodeRepo helpers from engine.test.ts)

describe("Plan D — typed backend handoff (integration)", () => {
  it("persists a validated BackendArtifact and surfaces it to a downstream consumer", async () => {
    // 1. Construct a fake IRitualEngine that emits a real BackendArtifact event
    //    when getRitual is polled for the backend node's ritualId.
    // 2. Construct WorkflowEngine with the fake.
    // 3. engine.start(...) with a planner that produces a 2-node DAG:
    //    [backend (kind: backend-rest-api), frontend (kind: frontend-app, consumes: [backend])]
    // 4. engine.approvePlan(...) to kick the scheduler.
    // 5. Await scheduler completion.
    // 6. Snapshot the run; assert backend node's artifact.kind === "backend-rest-api"
    //    and its routes/openApiSpec match what the fake emitted.
    // 7. Spy on the launchRitual call for the frontend node; assert its
    //    priorArtifact.upstream[backendNodeId].kind === "backend-rest-api".

    expect.fail("scaffold this test using engine.test.ts patterns; once green, remove this fail()");
  });
});
```

NOTE: This is a high-value test but it's also the most code. The implementer fills in steps 1-7 by mirroring the existing `integration-real-planner.test.ts` patterns. The `expect.fail` line is a deliberate placeholder so the test fails red until properly written — preventing accidental "PR with skipped test" merges.

- [ ] **Step 2: Implement the fake ritual engine**

```ts
// inside the test file
function makeFakeRitualEngine(emit: { [ritualId: string]: { artifact: unknown; artifactKind: string } }): IRitualEngine {
  let counter = 0;
  return {
    async start() { return `ritual-${++counter}`; },
    async getRitual(ritualId: string) {
      const e = emit[ritualId];
      return {
        state: "completed",
        roleEvents: e
          ? [{ eventType: "ritual.artifact_emitted", payload: { fromRole: "backend-artifact", artifact: e.artifact } }]
          : []
      };
    },
    async abort() {}
  };
}
```

- [ ] **Step 3: Drive engine.start() + approve + assert**

Use the existing test patterns in `packages/workflow-engine/test/integration-real-planner.test.ts` for fixture shape. The asserting code:

```ts
const snapshot = await engine.getRun(workflowRunId);
const backendNode = snapshot!.nodes.find((n) => n.artifactKind === "backend-rest-api")!;
expect((backendNode.artifact as { kind: string }).kind).toBe("backend-rest-api");
expect((backendNode.artifact as { routes: unknown[] }).routes).toHaveLength(1);
```

For the downstream consumption assertion: spy on `launchRitual` (the scheduler-config callback in `engine.ts`) by overriding `makeLaunchRitual`. The spy should record the `priorArtifact` it receives. Assert `priorArtifact.upstream[backendNodeId].kind === "backend-rest-api"`.

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/workflow-engine test integration-backend-handoff
```
Expected: PASS.

```bash
git add packages/workflow-engine/test/integration-backend-handoff.test.ts
git commit -m "test(workflow-engine): end-to-end typed BackendArtifact handoff (Plan D Task 9)"
```

---

## Plan D — Self-review checklist

- [ ] Spec §1 (Foundation handoff) → Task 2 + Task 9
- [ ] Spec §2 (BackendArtifact contract) → Task 1
- [ ] Spec §3 (Role emits artifact) → Tasks 4 + 5
- [ ] Spec §4 (Python build gate) → Task 3 (existing `gate-build` registry already wires pyright; Task 3 just installs it in the template)
- [ ] Spec §5 (Swagger UI renderer) → Tasks 7 + 8
- [ ] Spec §6 (Testing strategy) → Tasks 1, 2, 4, 5, 7, 9
- [ ] Spec §7 (Risks + out-of-scope) → Honored by stopping after Task 9 (no frontend consumption, no GraphQL, no auth code gen)

**Shippable result:** A user submits a backend-shaped prompt → workflow-planner produces a DAG with a `backend-rest-api` node → role-developer applies a FastAPI diff → build-gate runs pyright against the sandbox → `BackendArtifactRole` fetches the live OpenAPI spec → emits a `ritual.artifact_emitted` event → the workflow engine validates it against `BackendArtifactSchema` → persists it on the workflow node → the user drills into the node and sees live Swagger UI plus a copy-curl button. The typed artifact now sits in `workflow_nodes.artifact` ready for Plan D.2 to consume from a frontend node.
