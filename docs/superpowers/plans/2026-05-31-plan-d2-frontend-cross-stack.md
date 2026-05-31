# Plan D.2 — Frontend Cross-Stack API Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a typed TypeScript API client from a backend node's `BackendArtifact.openApiSpec` (via `openapi-typescript`) and thread it into a downstream frontend ritual's `priorArtifact.generatedFiles`. The developer role's prompt assembler surfaces it so the LLM includes the file in its diff. Closes Plan D's typed-handoff thesis on the consumer side.

**Architecture:** All cross-stack logic lives in the workflow engine at the `makeLaunchRitual` site. The `role-developer`'s prompt extension is purely a context-surfacing change. No new role, no new sandbox round-trip — `openapi-typescript` runs in-process.

**Tech Stack:** TypeScript pnpm monorepo, `openapi-typescript` (npm, deterministic JSON → TS codegen), vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-31-plan-d2-frontend-cross-stack-design.md`

**Depends on:** Plans A + B + C + D + E + F merged. Branch off current `main` (`dfab819`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/api-client-gen.ts` | Pure `generateApiClient(openApiSpec)` → `{ path, contents }` via `openapi-typescript` |
| `packages/workflow-engine/test/api-client-gen.test.ts` | Unit tests on a small OpenAPI fixture |
| `packages/workflow-engine/test/engine-launch-ritual-cross-stack.test.ts` | launchRitual injects generatedFiles for backend→frontend; throws on multi-backend |
| `packages/role-developer/test/assemble-prompt-generated-files.test.ts` | Prompt assembler renders the "Pre-generated files" section |
| `packages/workflow-engine/test/integration-frontend-cross-stack.test.ts` | End-to-end 2-node DAG asserting the file flows |

### Modified files
| File | Change |
|---|---|
| `packages/workflow-engine/package.json` | Add `openapi-typescript` as a runtime dependency |
| `packages/workflow-engine/src/engine.ts` | Extend `makeLaunchRitual`: scan upstreams for backend-rest-api; on single → inject generatedFiles; on multi → throw |
| `packages/role-developer/src/assemble-prompt.ts` | Render `priorArtifact.generatedFiles` as a context section in the developer prompt |

---

## Tasks

### Task 1: Add `openapi-typescript` dep

**Files:**
- Modify: `packages/workflow-engine/package.json`

- [ ] **Step 1:** Pick the major version. Current openapi-typescript stable is 7.x (programmatic API: `openapi-typescript(input, options) → Promise<string>`). Use `"openapi-typescript": "^7.4.0"`.

- [ ] **Step 2:** Add to dependencies (not devDependencies — used at runtime in workflow-engine):

```json
{
  "dependencies": {
    "@atlas/...": "...",
    "openapi-typescript": "^7.4.0",
    "...": "..."
  }
}
```

- [ ] **Step 3:** Install + verify:

```bash
cd F:/claude/ai_builder && pnpm install 2>&1 | tail -5
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine exec node -e "console.log(typeof require('openapi-typescript').default)"
```

Expected: `function` or `object` (depending on ESM/CJS export shape).

- [ ] **Step 4: Commit**

```bash
git add packages/workflow-engine/package.json pnpm-lock.yaml
git commit -m "chore(workflow-engine): add openapi-typescript dep for cross-stack API client codegen (Plan D.2 Task 1)"
```

---

### Task 2: `generateApiClient` pure helper

**Files:**
- Create: `packages/workflow-engine/src/api-client-gen.ts`
- Create: `packages/workflow-engine/test/api-client-gen.test.ts`

- [ ] **Step 1: Failing test** at `packages/workflow-engine/test/api-client-gen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateApiClient } from "../src/api-client-gen.js";

const SIMPLE_SPEC = {
  openapi: "3.1.0",
  info: { title: "Demo", version: "0.0.1" },
  paths: {
    "/health": {
      get: {
        operationId: "get_health",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" } },
                  required: ["status"]
                }
              }
            }
          }
        }
      }
    }
  }
};

describe("generateApiClient", () => {
  it("returns the canonical lib/api-client.ts path", async () => {
    const r = await generateApiClient(SIMPLE_SPEC);
    expect(r.path).toBe("lib/api-client.ts");
  });

  it("emits TypeScript that includes the paths interface", async () => {
    const r = await generateApiClient(SIMPLE_SPEC);
    expect(r.contents).toMatch(/export\s+interface\s+paths/);
    expect(r.contents).toContain("/health");
  });

  it("includes components when the spec defines schemas", async () => {
    const withComponents = {
      ...SIMPLE_SPEC,
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        }
      }
    };
    const r = await generateApiClient(withComponents);
    expect(r.contents).toMatch(/User/);
  });

  it("throws on a non-OpenAPI object", async () => {
    await expect(generateApiClient({ not: "openapi" } as never)).rejects.toThrow();
  });
});
```

- [ ] **Step 2:** Run, expect failure:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test api-client-gen
```

- [ ] **Step 3: Implement** `packages/workflow-engine/src/api-client-gen.ts`:

```ts
import openapiTS, { astToString } from "openapi-typescript";

export interface GeneratedClient {
  path: string;
  contents: string;
}

/**
 * Generates a TypeScript API client from an OpenAPI 3.x spec object via
 * the openapi-typescript library. Returns the canonical file path
 * (lib/api-client.ts) + the rendered TypeScript source.
 *
 * Pure — no I/O, no LLM. Throws if the input is not a valid OpenAPI doc.
 */
export async function generateApiClient(openApiSpec: unknown): Promise<GeneratedClient> {
  // openapi-typescript v7 accepts a Document, a URL, or a JSON string.
  // We pass the object directly.
  const ast = await openapiTS(openApiSpec as never);
  const contents = astToString(ast);
  return { path: "lib/api-client.ts", contents };
}
```

Note: openapi-typescript v7's exact import shape may differ — verify by reading `node_modules/openapi-typescript/package.json` (look at `exports`) and `node_modules/openapi-typescript/dist/index.d.ts` (look at the default export). If the API is different (e.g. no `astToString`, or default-only export), adapt the implementation. The test should still pass — what matters is the output shape, not the library's internal API surface.

- [ ] **Step 4:** Export from `packages/workflow-engine/src/index.ts`:

```ts
export { generateApiClient, type GeneratedClient } from "./api-client-gen.js";
```

- [ ] **Step 5:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine typecheck
git add packages/workflow-engine/src/api-client-gen.ts packages/workflow-engine/src/index.ts packages/workflow-engine/test/api-client-gen.test.ts
git commit -m "feat(workflow-engine): generateApiClient pure helper via openapi-typescript (Plan D.2 Task 2)"
```

---

### Task 3: Inject `generatedFiles` in `makeLaunchRitual`

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts`
- Create: `packages/workflow-engine/test/engine-launch-ritual-cross-stack.test.ts`

The launchRitual closure already (Plan D Task 8.5) walks `node.consumes` to build `priorArtifact.upstream`. Add a step: after building upstream, scan it for `backend-rest-api` artifacts. If exactly one, call `generateApiClient(artifact.openApiSpec)` and inject into `priorArtifact.generatedFiles`. If two or more, throw with a clear error.

- [ ] **Step 1: Failing test** at `packages/workflow-engine/test/engine-launch-ritual-cross-stack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js";
import { WorkflowEngine, type IRitualEngine } from "../src/engine.js";

// Adapt the makeRunRepo + makeNodeRepo helpers from engine.test.ts or import them.

const BACKEND_SPEC = {
  openapi: "3.1.0",
  info: { title: "demo", version: "1" },
  paths: { "/health": { get: { operationId: "h", responses: { "200": { description: "ok" } } } } }
};

const BACKEND_ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: BACKEND_SPEC,
  routes: [],
  envContract: [],
  sandboxId: "sb-1"
};

describe("makeLaunchRitual — cross-stack api-client injection", () => {
  it("injects generatedFiles when a frontend node consumes a single backend-rest-api upstream", async () => {
    // 1. Seed run + 2 nodes (backend done with persisted artifact, frontend pending consuming backend)
    // 2. Build engine with a recording ritualEngine
    // 3. Manually trigger one launchRitual call for the frontend node
    // 4. Assert recorded start() input has priorArtifact.generatedFiles with one entry whose path is "lib/api-client.ts"
    //    and whose contents contains "export interface paths"
  });

  it("throws a clear error when frontend consumes 2+ backend-rest-api upstreams", async () => {
    // 1. Seed 3 nodes (backend-a + backend-b both done; frontend pending consuming both)
    // 2. Trigger launchRitual for the frontend
    // 3. Assert it throws with a message containing "multiple backend upstreams not supported"
  });

  it("does NOT inject generatedFiles when no backend-rest-api upstreams exist", async () => {
    // Single frontend node with no upstreams → no generatedFiles in priorArtifact
  });
});
```

Fill in the test scaffolding by mirroring `engine-launch-ritual.test.ts` from Plan D Task 8.5.

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** the launchRitual extension in `packages/workflow-engine/src/engine.ts`:

Find the `makeLaunchRitual` body (search for `node.consumes`). After the existing upstream-merge block, add the cross-stack injection:

```ts
// Existing upstream loop builds `upstream: Record<string, unknown>`
// ... (unchanged)

// Plan D.2: Generate cross-stack API client for frontend nodes consuming backend.
const generatedFiles: Array<{ path: string; contents: string }> = [];
if (node.artifactKind === "frontend-app") {
  const backendUpstreams = Object.values(upstream).filter(
    (a) => a && typeof a === "object" && (a as { kind?: unknown }).kind === "backend-rest-api"
  ) as Array<{ kind: string; openApiSpec: unknown }>;

  if (backendUpstreams.length > 1) {
    throw new Error(
      `Plan D.2 v1: multiple backend upstreams not supported (frontend node "${node.id}" consumes ${backendUpstreams.length}). Multi-backend cross-stack is Plan D.3.`
    );
  }
  if (backendUpstreams.length === 1) {
    const generated = await generateApiClient(backendUpstreams[0]!.openApiSpec);
    generatedFiles.push(generated);
  }
}

const priorArtifact = {
  upstream,
  dependencyProfile: run.dependencyProfile,
  ...(generatedFiles.length > 0 ? { generatedFiles } : {})
};
```

Add the import at the top of `engine.ts`:

```ts
import { generateApiClient } from "./api-client-gen.js";
```

- [ ] **Step 4:** Run tests:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test engine-launch-ritual-cross-stack
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
```

Both should pass. Full suite should be 128 (127 from Plan F end + 1 new).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-engine/src/engine.ts packages/workflow-engine/test/engine-launch-ritual-cross-stack.test.ts
git commit -m "feat(workflow-engine): inject typed api-client into priorArtifact.generatedFiles for frontend↔backend cross-stack (Plan D.2 Task 3)"
```

---

### Task 4: Extend `role-developer`'s prompt assembler to surface `generatedFiles`

**Files:**
- Modify: `packages/role-developer/src/assemble-prompt.ts`
- Create: `packages/role-developer/test/assemble-prompt-generated-files.test.ts`

The developer role's prompt assembler currently builds a user-turn from architect artifact + graphSlice + userTurn. Add a section that reads `priorArtifact.generatedFiles` and renders them as: `"## Pre-generated files (these have been written to your sandbox; include them in your diff verbatim)"` followed by each file's path + contents.

- [ ] **Step 1: Investigate**

Read `packages/role-developer/src/assemble-prompt.ts` to understand the current prompt-assembly shape. Find where `priorArtifact` is consumed. If the assembler is a pure function `assemblePrompt(input)` → string, extend its input type and string output. If the assembler is wrapped behind other layers, find the right point to inject.

If the file's structure is significantly different from a single pure-function pattern, STOP and report NEEDS_CONTEXT.

- [ ] **Step 2: Failing test** at `packages/role-developer/test/assemble-prompt-generated-files.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assemblePrompt } from "../src/assemble-prompt.js"; // adapt name if different

describe("assemblePrompt — generatedFiles cross-stack section", () => {
  it("renders a Pre-generated files section when priorArtifact.generatedFiles is non-empty", () => {
    const result = assemblePrompt({
      userTurn: "Build the dashboard",
      architectArtifact: null,
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        generatedFiles: [
          { path: "lib/api-client.ts", contents: "export interface paths { /* ... */ }" }
        ]
      }
    });
    expect(result).toMatch(/Pre-generated files/i);
    expect(result).toContain("lib/api-client.ts");
    expect(result).toContain("export interface paths");
  });

  it("omits the section when priorArtifact.generatedFiles is missing", () => {
    const result = assemblePrompt({
      userTurn: "Build the dashboard",
      architectArtifact: null,
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: null
    });
    expect(result).not.toMatch(/Pre-generated files/i);
  });

  it("omits the section when generatedFiles is an empty array", () => {
    const result = assemblePrompt({
      userTurn: "X",
      architectArtifact: null,
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { generatedFiles: [] }
    });
    expect(result).not.toMatch(/Pre-generated files/i);
  });
});
```

Note: the exact `assemblePrompt` signature may differ (e.g. it might take a `RoleInvocation` directly). Adapt the test to call whatever function the developer role uses to build its user-turn.

- [ ] **Step 3:** Run, expect failure.

- [ ] **Step 4: Implement** the prompt extension. Roughly:

```ts
// inside assemble-prompt.ts, where the prompt body is composed:
const prior = (priorArtifact ?? null) as { generatedFiles?: Array<{ path: string; contents: string }> } | null;
const generatedFiles = prior?.generatedFiles ?? [];
const generatedFilesSection = generatedFiles.length > 0
  ? [
      "## Pre-generated files",
      "These files have been written to your sandbox by upstream workflow steps.",
      "Include them in your diff verbatim so they end up applied to disk.",
      "Then import from them as needed in your own code:",
      "",
      ...generatedFiles.map((f) => [`### ${f.path}`, "```ts", f.contents, "```", ""].join("\n"))
    ].join("\n\n")
  : "";

// then thread `generatedFilesSection` into the assembled prompt at the right point —
// e.g. after the architect-artifact section, before the user-turn.
```

- [ ] **Step 5:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-developer test assemble-prompt-generated-files
cd F:/claude/ai_builder && pnpm -F @atlas/role-developer test
cd F:/claude/ai_builder && pnpm -F @atlas/role-developer typecheck
git add packages/role-developer/src/assemble-prompt.ts packages/role-developer/test/assemble-prompt-generated-files.test.ts
git commit -m "feat(role-developer): surface priorArtifact.generatedFiles in the developer prompt (Plan D.2 Task 4)"
```

---

### Task 5: End-to-end integration test

**Files:**
- Create: `packages/workflow-engine/test/integration-frontend-cross-stack.test.ts`

Two-node DAG (backend → frontend with `consumes: ["backend"]`). Fake `IRitualEngine.start()` records calls. `getRitual()` returns a completed snapshot with a real BackendArtifact emitted for the backend ritual, and an empty snapshot for the frontend ritual.

Assertions:
1. The frontend's recorded `start()` call captured `priorArtifact.generatedFiles` with one entry whose `path === "lib/api-client.ts"` and whose `contents` contains the expected TS substrings (`export interface paths`).
2. The frontend's `priorArtifact.upstream.backend.kind === "backend-rest-api"` (sanity check — Plan D Task 8.5 baseline behavior still holds).

- [ ] **Step 1:** Write the test. Mirror `packages/workflow-engine/test/integration-tests-handoff.test.ts` (Plan E) for the fake setup; mirror `integration-backend-handoff.test.ts` (Plan D) for the artifact-emission fake pattern.

CRITICAL: at the top:
```ts
import "../src/artifact-contracts/backend-rest-api.js";
```

(register the kind so awaitRitual validates BackendArtifact instead of generic-fallback)

- [ ] **Step 2:** Run + verify:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test integration-frontend-cross-stack
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
```

Expected: full suite 129 (128 + 1 new).

- [ ] **Step 3: Commit**

```bash
git add packages/workflow-engine/test/integration-frontend-cross-stack.test.ts
git commit -m "test(workflow-engine): end-to-end backend → frontend cross-stack api-client (Plan D.2 Task 5)"
```

---

## Plan D.2 — Self-review checklist

- [ ] Spec §"Mechanical codegen" → Tasks 1, 2
- [ ] Spec §"Generation happens at makeLaunchRitual" → Task 3
- [ ] Spec §"Single-backend per frontend for v1" → Task 3 throw-path test
- [ ] Spec §"Developer role writes the file" → Task 4 (prompt surface)
- [ ] Spec §"No runtime verification" → Honored — we don't add structural eval rubric checks

**Shippable result:** A workflow with a backend node + a frontend node consuming it ends with a `lib/api-client.ts` file in the frontend's sandbox, mechanically generated from the backend's OpenAPI spec. The developer's prompt now includes the file's contents as a "Pre-generated files" section so the LLM emits it verbatim in its diff. The typed handoff loop closes end-to-end without LLM prompt-engineering for schema translation.
