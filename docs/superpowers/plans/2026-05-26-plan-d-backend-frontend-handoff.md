# Plan D — backend-rest-api ↔ frontend-app Typed Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first real cross-stack handoff work end-to-end. A backend ritual emits a typed `BackendArtifact` (OpenAPI 3.1 spec + routes + envContract); a frontend ritual consumes it via `priorArtifact.upstream` and generates a typed `lib/api-client.ts` whose function signatures match the backend's spec. After this plan, "build me a full-stack SaaS" produces a working two-tier app.

**Architecture:** No new packages. We add typed artifact schemas + producer/consumer code in existing roles. Backend ritual: when `template = atlas-fastapi` (or any backend template), the developer role's tool-use schema is extended to require the BackendArtifact fields and an artifact-validator confirms the schema before the node is marked done. Frontend ritual: when `priorArtifact.upstream[<id>].kind === "backend-rest-api"`, the developer's prompt gets an "## Upstream API" section listing every route, and the deepPlan synthesizes a `lib/api-client.ts` from the OpenAPI spec using `openapi-typescript` (new dep).

**Tech Stack:** Same. New deps: `openapi-typescript`.

**Spec reference:** Section 4 (typed contracts), Section 10 (per-artifact-kind details).

**Depends on:** Plans A + B + C merged.

---

## File Structure

### New
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts` | `BackendRestApiArtifactSchema` |
| `packages/workflow-engine/src/artifact-contracts/frontend-app.ts` | `FrontendAppArtifactSchema` |
| `packages/role-developer/src/sandbox-context-prompts/atlas-fastapi.ts` (new fragment) OR extend the existing prompt to include the backend tool-use schema | Backend developer prompt fragment that produces openApiSpec + routes |
| `packages/role-developer/src/upstream-artifact-merge.ts` | Helper: given inv.priorArtifact, extract upstream artifacts + format an "## Upstream artifacts" prompt section |
| `packages/role-developer/src/generate-api-client.ts` | Calls `openapi-typescript` to emit a typed client from an OpenAPI spec |
| `apps/atlas-web/components/workflow/renderers/BackendNodeRenderer.tsx` | Swagger UI panel (uses `swagger-ui-react`) |

### Modifications
| File | Change |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/index.ts` | Register the two new schemas |
| `packages/role-developer/src/anthropic-pass.ts` | Per-template tool-use schema selection |
| `packages/role-developer/src/google-pass.ts` | Same |
| `packages/role-developer/src/role.ts` | After successful pass, validate artifact against per-kind schema |
| `packages/role-developer/src/assemble-prompt.ts` | Add "## Upstream artifacts" section when present |
| `packages/role-developer/package.json` | Add `openapi-typescript` dep |
| `apps/atlas-web/package.json` | Add `swagger-ui-react` dep |
| `apps/atlas-web/components/canvas/register-renderers.ts` | Replace backend stub with real `BackendNodeRenderer` |
| `apps/atlas-web/e2e/tests/workflow-backend-frontend.spec.ts` | New e2e |

---

## Tasks

### Task 1: BackendRestApiArtifactSchema

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts`
- Test: `packages/workflow-engine/test/artifact-contracts-backend.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { BackendRestApiArtifactSchema } from "../src/artifact-contracts/backend-rest-api.js";

describe("BackendRestApiArtifactSchema", () => {
  it("accepts a minimal valid artifact", () => {
    const ok = BackendRestApiArtifactSchema.safeParse({
      schemaVersion: "1",
      kind: "backend-rest-api",
      openApiSpec: { openapi: "3.1.0", info: { title: "x", version: "0.0.1" }, paths: {} },
      routes: [{ method: "GET", path: "/health", opId: "healthCheck" }],
      envContract: [],
      sandboxId: "sb_abc"
    });
    expect(ok.success).toBe(true);
  });
  it("rejects when routes is empty", () => {
    const bad = BackendRestApiArtifactSchema.safeParse({
      schemaVersion: "1", kind: "backend-rest-api",
      openApiSpec: { openapi: "3.1.0", info: { title: "x", version: "0.0.1" }, paths: {} },
      routes: [],
      envContract: [],
      sandboxId: "sb"
    });
    expect(bad.success).toBe(false);
  });
  it("rejects mismatched kind", () => {
    const bad = BackendRestApiArtifactSchema.safeParse({
      schemaVersion: "1", kind: "frontend-app",
      openApiSpec: {},
      routes: [{ method: "GET", path: "/" }],
      envContract: [],
      sandboxId: "sb"
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts
import { z } from "zod";

export const RouteSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  path: z.string().min(1),
  opId: z.string().optional(),
  requestSchema: z.unknown().optional(),
  responseSchema: z.unknown().optional()
});

export const EnvVarSchema = z.object({
  name: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/, "env vars must be UPPER_SNAKE"),
  required: z.boolean(),
  description: z.string()
});

export const BackendRestApiArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-rest-api"),
  openApiSpec: z.record(z.unknown()), // accept any OpenAPI 3.x shape; we don't fully validate it ourselves
  routes: z.array(RouteSchema).min(1),
  dbDdl: z.string().optional(),
  envContract: z.array(EnvVarSchema),
  sandboxId: z.string().min(1),
  previewUrl: z.string().url().optional()
});
export type BackendRestApiArtifact = z.infer<typeof BackendRestApiArtifactSchema>;
```

- [ ] **Step 3: Register + commit**

```ts
// packages/workflow-engine/src/artifact-contracts/index.ts — register at module load
import { BackendRestApiArtifactSchema } from "./backend-rest-api.js";
ArtifactContractRegistry.register("backend-rest-api", BackendRestApiArtifactSchema);
export { BackendRestApiArtifactSchema };
```

```bash
git add packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts packages/workflow-engine/src/artifact-contracts/index.ts packages/workflow-engine/test/artifact-contracts-backend.test.ts
git commit -m "feat(workflow-engine): BackendRestApiArtifactSchema (v1)"
```

---

### Task 2: FrontendAppArtifactSchema

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/frontend-app.ts`
- Test: `packages/workflow-engine/test/artifact-contracts-frontend.test.ts`

- [ ] Implement following Task 1's pattern:

```ts
export const FrontendAppArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("frontend-app"),
  pages: z.array(z.object({ route: z.string(), file: z.string() })).min(1),
  designTokens: z.record(z.unknown()),
  apiClientFile: z.string().optional(),
  references: z.array(z.object({
    from: z.string(),
    kind: z.string()
  })).default([])
});
```

- [ ] Register + commit (`feat(workflow-engine): FrontendAppArtifactSchema (v1)`)

---

### Task 3: Backend developer prompt fragment (atlas-fastapi)

**Files:**
- Modify: `packages/role-developer/src/sandbox-context-prompts/fastapi.ts` (or whichever file already holds the FastAPI sandbox context — check existing names)
- Create if missing

Goal: the developer role, when targeting `atlas-fastapi`, should be steered to produce:
1. `app/main.py` with FastAPI setup
2. Route handlers under `app/routes/`
3. A `Spec` file or auto-generated `openapi.json` (FastAPI does this natively at `/openapi.json`)
4. An `envContract` declaration in a known file or in the tool-use response

The cleanest path: extend the developer's tool-use schema so the LLM emits `openApiSpec` + `routes` + `envContract` AS PART OF the tool output, alongside the diff. The validator then checks the OpenAPI spec exists and routes match.

- [ ] **Step 1: Extend the developer tool-use schema for backend-rest-api**

In `packages/role-developer/src/anthropic-pass.ts`:

```ts
const DEVELOPER_TOOL_SCHEMA_BACKEND = {
  type: "object",
  properties: {
    diff: { type: "string" },
    summary: { type: "string" },
    testsAdded: { type: "array", items: { type: "string" } },
    filesModified: { type: "array", items: { type: "string" } },
    openApiSpec: { type: "object", description: "Full OpenAPI 3.1 document for the API you built" },
    routes: { type: "array", items: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, opId: { type: "string" } }, required: ["method", "path"] } },
    envContract: { type: "array", items: { type: "object", properties: { name: { type: "string" }, required: { type: "boolean" }, description: { type: "string" } }, required: ["name", "required", "description"] } }
  },
  required: ["diff", "summary", "testsAdded", "filesModified", "openApiSpec", "routes", "envContract"]
} as const;

// Pick the schema based on input.targetTemplate
const TOOL_SCHEMA = input.targetTemplate?.startsWith("atlas-fastapi") || input.targetTemplate?.startsWith("atlas-graphql")
  ? DEVELOPER_TOOL_SCHEMA_BACKEND
  : DEVELOPER_TOOL_SCHEMA; // existing one for frontend
```

- [ ] **Step 2: System prompt fragment for backend templates**

Add to `assemble-prompt.ts` (extending existing per-template logic):

```ts
// When template is atlas-fastapi:
const FASTAPI_CONTEXT = `You are building a FastAPI Python backend.
- Use FastAPI with Pydantic models for every request/response shape.
- Routes live under \`app/routes/<resource>.py\`; import them into \`app/main.py\`.
- Every endpoint MUST have an \`operation_id\` for OpenAPI clarity.
- Every env var the app reads MUST be declared in the envContract field of your output (UPPER_SNAKE, name + required + description).
- Emit the OpenAPI 3.1 spec via FastAPI's built-in mechanism; ALSO include the parsed spec in the \`openApiSpec\` field of your tool output.
- Routes you implemented MUST be enumerated in the \`routes\` field.`;
```

- [ ] **Step 3: Tests + commit**

Test with a stub LLM that returns the new shape; verify the role parses it.

```bash
git add packages/role-developer
git commit -m "feat(role-developer): backend tool-use schema for atlas-fastapi (openApiSpec + routes + envContract)"
```

---

### Task 4: Artifact validation in role-developer

**Files:**
- Modify: `packages/role-developer/src/role.ts`

After the developer role completes, validate the emitted artifact against the per-kind schema (if one is registered). On failure, return a `developer.artifact_invalid` event and let the engine treat the node as failed (consistent with Section 7's failure rules).

- [ ] **Step 1: Add validation step**

```ts
// inside role.ts after the dispatch returns
import { parseWorkflowArtifact, ArtifactContractRegistry } from "@atlas/workflow-engine";

// ...after winner = google/anthropic output is selected
const artifactKind = inferArtifactKindFromTemplate(this.opts.targetTemplate);
if (artifactKind && ArtifactContractRegistry.has(artifactKind)) {
  try {
    parseWorkflowArtifact({
      schemaVersion: "1",
      kind: artifactKind,
      ...(winner.openApiSpec ? { openApiSpec: winner.openApiSpec, routes: winner.routes, envContract: winner.envContract, sandboxId: ... } : {})
    }, artifactKind);
  } catch (err) {
    events.push({ eventType: "developer.artifact_invalid", payload: { error: (err as Error).message } });
    throw new Error(`developer artifact validation failed for kind=${artifactKind}: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 2: Commit** (`feat(role-developer): validate emitted artifact against workflow-engine contract`)

---

### Task 5: Upstream-artifact merge helper

**Files:**
- Create: `packages/role-developer/src/upstream-artifact-merge.ts`
- Test: `packages/role-developer/test/upstream-artifact-merge.test.ts`

Helper that the role uses to format an "## Upstream artifacts" section for the deepPlan / developer prompt.

- [ ] **Step 1: Implement**

```ts
// upstream-artifact-merge.ts
export interface UpstreamArtifact {
  kind: string;
  [key: string]: unknown;
}

export function extractUpstreamArtifacts(priorArtifact: unknown): Record<string, UpstreamArtifact> {
  if (!priorArtifact || typeof priorArtifact !== "object") return {};
  const upstream = (priorArtifact as { upstream?: unknown }).upstream;
  if (!upstream || typeof upstream !== "object") return {};
  return upstream as Record<string, UpstreamArtifact>;
}

export function renderUpstreamArtifactsSection(upstream: Record<string, UpstreamArtifact>): string {
  const ids = Object.keys(upstream);
  if (ids.length === 0) return "";
  const parts: string[] = ["## Upstream artifacts\n"];
  for (const id of ids) {
    const a = upstream[id]!;
    parts.push(`### ${id} (kind: ${a.kind})\n`);
    if (a.kind === "backend-rest-api") {
      const routes = (a as any).routes as Array<{ method: string; path: string; opId?: string }>;
      const env = (a as any).envContract as Array<{ name: string; required: boolean; description: string }>;
      const url = (a as any).previewUrl as string | undefined;
      parts.push(`- Preview URL: ${url ?? "(not yet provisioned)"}\n`);
      parts.push(`- Routes:\n${routes.map((r) => `  - \`${r.method} ${r.path}\`${r.opId ? ` → ${r.opId}` : ""}`).join("\n")}\n`);
      if (env.length) parts.push(`- Env contract:\n${env.map((e) => `  - \`${e.name}\` ${e.required ? "(required)" : ""}: ${e.description}`).join("\n")}\n`);
    } else {
      parts.push("(opaque payload — kind-specific renderer not implemented for this prompt)\n");
    }
  }
  return parts.join("\n");
}
```

- [ ] **Step 2: Wire into prompts**

In `assemble-prompt.ts`, prepend the section to the user-turn or system prompt body.

- [ ] **Step 3: Tests + commit**

---

### Task 6: API client generation for the frontend role

**Files:**
- Create: `packages/role-developer/src/generate-api-client.ts`
- Test: `packages/role-developer/test/generate-api-client.test.ts`
- Modify: `packages/role-developer/package.json` — add `openapi-typescript` dep

- [ ] **Step 1: Add openapi-typescript**

```bash
pnpm --filter @atlas/role-developer add openapi-typescript
```

- [ ] **Step 2: Implement**

```ts
// generate-api-client.ts
import openapiTS from "openapi-typescript";

export async function generateApiClientTs(openApiSpec: Record<string, unknown>): Promise<string> {
  // openapi-typescript v7 returns AST nodes; we astToString them. v6 returns a string directly.
  // (Lock to v7+; adjust if upstream API differs.)
  const result = await openapiTS(openApiSpec as any);
  const header = `// AUTO-GENERATED by @atlas/role-developer Plan D. Do not edit.\n// Source: upstream backend's OpenAPI spec.\n\n`;
  return header + (typeof result === "string" ? result : (result as { astToString: () => string }).astToString());
}
```

- [ ] **Step 3: Integrate into the frontend developer role**

When the frontend developer role detects an upstream `backend-rest-api` artifact:
1. Call `generateApiClientTs(upstream.openApiSpec)`
2. Add a `lib/api-client.ts` file to the diff with the generated content
3. Add `lib/api-client.ts` to `filesModified`

Pseudo-code:

```ts
// In role.ts after the developer pass succeeds:
const upstream = extractUpstreamArtifacts(inv.priorArtifact);
const backend = Object.values(upstream).find((a) => a.kind === "backend-rest-api") as BackendRestApiArtifact | undefined;
if (backend) {
  const clientTs = await generateApiClientTs(backend.openApiSpec);
  winner.diff = appendFileToDiff(winner.diff, "lib/api-client.ts", clientTs);
  winner.filesModified.push("lib/api-client.ts");
}
```

(`appendFileToDiff` helper writes a new-file diff stanza in unified-diff format.)

- [ ] **Step 4: Tests + commit**

Test: feed a minimal OpenAPI spec, assert the output is a valid TS module containing a type for at least one route.

---

### Task 7: BackendNodeRenderer (Swagger UI)

**Files:**
- Create: `apps/atlas-web/components/workflow/renderers/BackendNodeRenderer.tsx`
- Modify: `apps/atlas-web/package.json` — add `swagger-ui-react`

- [ ] **Step 1: Implement**

```tsx
"use client";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import type { BackendRestApiArtifact } from "@atlas/workflow-engine";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export function BackendNodeRenderer({ artifact }: { artifact: BackendRestApiArtifact }) {
  return (
    <div className="h-full overflow-auto">
      <SwaggerUI spec={artifact.openApiSpec} />
    </div>
  );
}
```

- [ ] **Step 2: Register in canvas-mode-registry (replace Plan C stub)**

- [ ] **Step 3: Commit** (`feat(atlas-web): BackendNodeRenderer (Swagger UI from BackendArtifact)`)

---

### Task 8: End-to-end test: backend → frontend handoff

**Files:**
- Create: `apps/atlas-web/e2e/tests/workflow-backend-frontend.spec.ts`

The flow:
1. Cold-start prompt: "Build a todo SaaS with a FastAPI backend and a Next.js frontend"
2. Classifier → workflow; planner emits 2-node DAG (backend → frontend)
3. Approve plan
4. Backend node runs; emits BackendArtifact (openApiSpec + routes for /todos + envContract)
5. Frontend node runs; reads upstream BackendArtifact via priorArtifact.upstream; generates `lib/api-client.ts`
6. Assert: the final frontend diff contains `lib/api-client.ts` with a function named after one of the backend routes' opIds
7. Assert: Swagger UI renders the openApiSpec on the backend node's drill-in view

- [ ] Implement (gated by `ATLAS_E2E_REAL_LLM=true`) + commit

---

## Plan D — Self-review checklist

- [ ] Spec section 4 (typed artifact contracts for backend + frontend) → Tasks 1, 2
- [ ] Spec section 10 (backend node specifics: openApiSpec, routes, envContract, Swagger renderer) → Tasks 3, 4, 7
- [ ] Spec section 10 (frontend consumes backend; api-client.ts from OpenAPI) → Tasks 5, 6
- [ ] Spec section 4 (artifact validation at producer side) → Task 4

**Shippable result:** First real "full-stack SaaS" workflows produce working two-tier apps where the frontend's API calls are typed against the backend's actual OpenAPI spec. No more silent route-name drift between tiers.
