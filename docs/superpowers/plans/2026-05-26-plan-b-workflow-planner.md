# Plan B — Real workflow-planner + Entry Classifier + DependencyProfile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan A's stub `workflow-planner` with a real LLM-driven role that emits multi-node DAGs, add the `classifyEntry` LLM that routes cold-start prompts to either single-ritual or workflow, and ship the full `DependencyProfile` schema with OSS-first defaults + per-provider user-override Q&A.

**Architecture:** A new `packages/role-workflow-planner` package implements `WorkflowPlannerRole` (triage Q&A reuses today's `triage-clarifications` canvas-pause kind; pass-2 synthesizes the DAG + DependencyProfile via tool_use). A new `classifyEntry` LLM call (model: gemini-2.5-flash) lives in atlas-web and is invoked by a new `startBuild` Server Action that routes to either today's `startRitual` or Plan A's `startWorkflow`. The flag triad (`ATLAS_FF_WORKFLOW`, `ATLAS_FF_WORKFLOW_PICKER`, `ATLAS_FF_WORKFLOW_KINDS`) is fully wired with progressive-rollout semantics.

**Tech Stack:** Same as Plan A. New deps: nothing.

**Spec reference:** Sections 3 (lifecycle plan phase), 9 (coexistence + flags), 12 (DependencyProfile).

**Depends on:** Plan A merged.

---

## File Structure

### New package: `packages/role-workflow-planner/`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Standard scaffold (mirror Plan A Task 1) |
| `src/index.ts` | Public exports |
| `src/role.ts` | `WorkflowPlannerRole` implements `Role` interface |
| `src/triage.ts` | Pass-1 prompt + LLM call that yields `AmbiguityReport` |
| `src/synthesize-dag.ts` | Pass-2 prompt + LLM call that yields `{nodes, dependencyProfile, reasoning}` |
| `src/types.ts` | `PlannerOutput` Zod schema |
| `test/role.test.ts` | Stub LLM; verifies event emissions match contract |
| `test/triage.test.ts` | Stub LLM returning blocker questions; verifies triage Q&A flow |
| `test/synthesize-dag.test.ts` | Stub LLM returning a 3-node DAG; verifies parsing |

### Modifications

| File | Change |
|---|---|
| `packages/workflow-engine/src/types.ts` | Expand `DependencyProfileSchema` to full v1 schema (auth/db/storage/email/jobs/payments/search/errorTracking/analytics/featureFlags) |
| `packages/workflow-engine/src/engine.ts` | Replace stub planner ritual with real role registration |
| `apps/atlas-web/lib/engine/factory.ts` | Register `WorkflowPlannerRole` in the conductor; pass dependency-profile defaults |
| `apps/atlas-web/lib/llm/classify-entry.ts` | New: `classifyEntry(prompt)` → `{mode, suggestedKinds, reasoning}` |
| `apps/atlas-web/lib/llm/dependency-profile-defaults.ts` | New: OSS-first defaults table |
| `apps/atlas-web/lib/actions/startBuild.ts` | New: routes to startRitual or startWorkflow |
| `apps/atlas-web/lib/feature-flags.ts` | Add `workflow-picker`, `workflow-kinds` (CSV value flag) |
| `apps/atlas-web/test/lib/llm/classify-entry.test.ts` | New |
| `apps/atlas-web/test/actions/startBuild.test.ts` | New |

---

## Tasks

### Task 1: Scaffold packages/role-workflow-planner

Mirror Plan A Task 1 with adjusted deps:

```json
{
  "name": "@atlas/role-workflow-planner",
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/workflow-engine": "workspace:*",
    "zod": "^3.23.0"
  }
}
```

- [ ] Scaffold + commit (`feat(role-workflow-planner): scaffold package skeleton`)

---

### Task 2: Full DependencyProfile schema in workflow-engine

**Files:**
- Modify: `packages/workflow-engine/src/types.ts` — replace the Plan A placeholder
- Test: `packages/workflow-engine/test/dependency-profile.test.ts`

- [ ] **Step 1: Test cases for the full schema**

```ts
import { describe, it, expect } from "vitest";
import { DependencyProfileSchema } from "../src/types.js";

describe("DependencyProfileSchema v1", () => {
  it("accepts the OSS-first defaults profile", () => {
    const profile = {
      schemaVersion: "1",
      auth: { provider: "keycloak", config: { realm: "atlas-user-app" } },
      db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" },
      storage: { provider: "minio", bucketEnvVar: "S3_BUCKET" },
      email: { provider: "mailpit" },
      jobs: { provider: "bullmq", redisUrlEnvVar: "REDIS_URL" },
      payments: { provider: "lago" },
      search: { provider: "meilisearch", apiKeyEnvVar: "MEILI_KEY" },
      errorTracking: { provider: "glitchtip", dsnEnvVar: "GLITCHTIP_DSN" },
      analytics: { provider: "posthog", apiKeyEnvVar: "POSTHOG_KEY" },
      featureFlags: { provider: "unleash", urlEnvVar: "UNLEASH_URL" }
    };
    expect(DependencyProfileSchema.safeParse(profile).success).toBe(true);
  });
  it("rejects unknown auth provider", () => {
    const bad = { schemaVersion: "1", auth: { provider: "not-a-real-thing" } };
    expect(DependencyProfileSchema.safeParse(bad).success).toBe(false);
  });
  it("schemaVersion must be literal '1'", () => {
    const bad = { schemaVersion: "2", auth: { provider: "keycloak" } };
    expect(DependencyProfileSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement the full schema** (replaces the Plan A placeholder)

```ts
// packages/workflow-engine/src/types.ts (replace existing DependencyProfileSchema)
export const DependencyProfileSchema = z.object({
  schemaVersion: z.literal("1"),
  auth: z.object({
    provider: z.enum(["keycloak", "clerk", "better-auth", "lucia", "auth-js", "none"]),
    config: z.record(z.unknown()).optional()
  }).optional(),
  db: z.object({
    provider: z.enum(["postgres", "neon", "supabase", "none"]),
    connectionStringEnvVar: z.string()
  }).optional(),
  storage: z.object({
    provider: z.enum(["minio", "s3", "none"]),
    bucketEnvVar: z.string()
  }).optional(),
  email: z.object({
    provider: z.enum(["mailpit", "postal", "resend", "postmark", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  jobs: z.object({
    provider: z.enum(["bullmq", "inngest", "trigger-dev", "none"]),
    redisUrlEnvVar: z.string().optional()
  }).optional(),
  payments: z.object({
    provider: z.enum(["lago", "stripe", "none"])
  }).optional(),
  search: z.object({
    provider: z.enum(["meilisearch", "typesense", "algolia", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  errorTracking: z.object({
    provider: z.enum(["glitchtip", "sentry", "none"]),
    dsnEnvVar: z.string().optional()
  }).optional(),
  analytics: z.object({
    provider: z.enum(["posthog", "plausible", "ga", "mixpanel", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  featureFlags: z.object({
    provider: z.enum(["unleash", "launchdarkly", "none"]),
    urlEnvVar: z.string().optional()
  }).optional()
});
export type DependencyProfile = z.infer<typeof DependencyProfileSchema>;
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/workflow-engine test dependency-profile
git add packages/workflow-engine/src/types.ts packages/workflow-engine/test/dependency-profile.test.ts
git commit -m "feat(workflow-engine): full DependencyProfile schema (v1)"
```

---

### Task 3: OSS-first defaults table

**Files:**
- Create: `apps/atlas-web/lib/llm/dependency-profile-defaults.ts`
- Test: `apps/atlas-web/test/lib/llm/dependency-profile-defaults.test.ts`

- [ ] **Step 1: Implement**

```ts
// apps/atlas-web/lib/llm/dependency-profile-defaults.ts
import type { DependencyProfile } from "@atlas/workflow-engine";

export function ossFirstDefaults(): DependencyProfile {
  return {
    schemaVersion: "1",
    auth: { provider: "keycloak" },
    db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" },
    storage: { provider: "minio", bucketEnvVar: "S3_BUCKET" },
    email: { provider: "mailpit" },
    jobs: { provider: "bullmq", redisUrlEnvVar: "REDIS_URL" },
    payments: { provider: "lago" },
    search: { provider: "meilisearch", apiKeyEnvVar: "MEILI_KEY" },
    errorTracking: { provider: "glitchtip", dsnEnvVar: "GLITCHTIP_DSN" },
    analytics: { provider: "posthog", apiKeyEnvVar: "POSTHOG_KEY" },
    featureFlags: { provider: "unleash", urlEnvVar: "UNLEASH_URL" }
  };
}

/** Heuristic: examine the prompt for concerns and return only the relevant
 *  subset. E.g. a "blog landing page" prompt returns a profile without
 *  payments/jobs/search. */
export function inferRelevantConcerns(prompt: string): Array<keyof DependencyProfile> {
  const concerns: Array<keyof DependencyProfile> = [];
  const lower = prompt.toLowerCase();
  if (/\b(login|users?|accounts?|auth|sign[- ]?(in|up)|sso)\b/.test(lower)) concerns.push("auth");
  if (/\b(db|database|persistent|users?|records?|history|notes?)\b/.test(lower)) concerns.push("db");
  if (/\b(upload|files?|images?|attachments?|storage|s3)\b/.test(lower)) concerns.push("storage");
  if (/\b(email|notify|notifications?|magic[- ]?link)\b/.test(lower)) concerns.push("email");
  if (/\b(job|queue|worker|cron|scheduled|background)\b/.test(lower)) concerns.push("jobs");
  if (/\b(pay|subscription|billing|stripe|invoice|plan)\b/.test(lower)) concerns.push("payments");
  if (/\b(search|find|filter|index)\b/.test(lower)) concerns.push("search");
  return concerns;
}
```

- [ ] **Step 2: Tests + commit**

(Standard heuristic tests; commit `feat(atlas-web): OSS-first DependencyProfile defaults + relevant-concerns heuristic`)

---

### Task 4: classifyEntry LLM call

**Files:**
- Create: `apps/atlas-web/lib/llm/classify-entry.ts`
- Test: `apps/atlas-web/test/lib/llm/classify-entry.test.ts`

- [ ] **Step 1: Implement**

```ts
// apps/atlas-web/lib/llm/classify-entry.ts
import type { LLMProvider } from "@atlas/llm-provider";

export interface ClassifyEntryInput {
  prompt: string;
  artifactKindHint?: string;
}

export interface ClassifyEntryResult {
  mode: "single-ritual" | "workflow";
  suggestedKinds?: string[];
  reasoning: string;
}

const SYSTEM_PROMPT = `You are the Atlas entry classifier.
Decide whether a prompt should be built as a single ritual (one artifact, today's flow)
or as a workflow (multiple coordinated artifacts: backend, frontend, tests, infra, deploy).

Single-ritual signals: "landing page", "marketing site", "hero section", "about page",
"one-page", "CLI tool", "mobile app" (if scoped to one platform), "data pipeline" (if standalone).

Workflow signals: words implying multiple tiers/services — "SaaS", "platform", "users",
"login", "signup", "billing", "subscription", "dashboard", "admin panel", "API + frontend",
"backend with web client", "database", "uploads + accounts", multi-feature apps.

If artifactKindHint is set (the user explicitly chose a single artifact kind), default to
single-ritual unless the prompt clearly implies multi-artifact.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["single-ritual", "workflow"] },
    suggestedKinds: {
      type: "array",
      items: { type: "string", enum: ["frontend-app", "backend-rest-api", "backend-graphql", "tests", "iac", "deploy", "data-pipeline", "mobile-app", "cli-tool"] }
    },
    reasoning: { type: "string" }
  },
  required: ["mode", "reasoning"]
} as const;

export async function classifyEntry(input: ClassifyEntryInput, llm: LLMProvider): Promise<ClassifyEntryResult> {
  const llmAny = llm as unknown as {
    completeWithToolUse: (m: unknown[], o: unknown) => Promise<{ input: ClassifyEntryResult }>;
  };
  const userTurn = input.artifactKindHint
    ? `Prompt: """${input.prompt}"""\n\nUser explicitly picked artifactKind: ${input.artifactKindHint}.`
    : `Prompt: """${input.prompt}"""`;
  const result = await llmAny.completeWithToolUse(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTurn }
    ],
    {
      model: process.env.ATLAS_LLM_TRIAGE_MODEL ?? "google/gemini-2.5-flash",
      maxTokens: 1024,
      tools: [{ name: "classify", description: "Emit classification", input_schema: TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "classify" }
    }
  );
  return result.input;
}
```

- [ ] **Step 2: Tests + commit**

Tests with a stub LLM returning canned `{mode, suggestedKinds, reasoning}`. Verify the prompt routing, the hint behavior, the tool wiring.

```bash
git add apps/atlas-web/lib/llm/classify-entry.ts apps/atlas-web/test/lib/llm/classify-entry.test.ts
git commit -m "feat(atlas-web): classifyEntry LLM call (gemini-2.5-flash)"
```

---

### Task 5: startBuild Server Action

**Files:**
- Create: `apps/atlas-web/lib/actions/startBuild.ts`
- Test: `apps/atlas-web/test/actions/startBuild.test.ts`

- [ ] **Step 1: Implement**

```ts
// apps/atlas-web/lib/actions/startBuild.ts
"use server";
import { auth } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { classifyEntry } from "@/lib/llm/classify-entry";
import { getOpenRouterProvider } from "@/lib/engine/factory";
import { startRitual } from "./startRitual";
import { startWorkflow } from "./startWorkflow";

export interface StartBuildInput {
  projectId: string;
  prompt: string;
  artifactKindHint?: string;
}

export type StartBuildResult =
  | { kind: "ritual"; ritualId: string }
  | { kind: "workflow"; workflowRunId: string; suggestedKinds: string[]; reasoning: string };

export async function startBuild(input: StartBuildInput): Promise<StartBuildResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  // Master flag OFF → always single-ritual (today's path)
  if (!isFeatureEnabled("workflow")) {
    const r = await startRitual({
      projectId: input.projectId,
      userTurn: input.prompt,
      editClass: "structural",
      ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint as any } : {})
    });
    return { kind: "ritual", ritualId: r.ritualId };
  }

  // Classifier verdict
  const llm = getOpenRouterProvider();
  let verdict: Awaited<ReturnType<typeof classifyEntry>>;
  try {
    verdict = await classifyEntry({ prompt: input.prompt, ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {}) }, llm);
  } catch (err) {
    // Fail-safe: fall back to single-ritual on classifier error
    console.warn("[atlas-web] classifyEntry failed; falling back to single-ritual", err);
    const r = await startRitual({ projectId: input.projectId, userTurn: input.prompt, editClass: "structural" });
    return { kind: "ritual", ritualId: r.ritualId };
  }

  // Filter suggestedKinds by ATLAS_FF_WORKFLOW_KINDS allow-list
  const kindsAllowList = readKindsAllowList();
  const suggestedKinds = (verdict.suggestedKinds ?? []).filter((k) => kindsAllowList.has(k));

  if (verdict.mode === "workflow" && suggestedKinds.length > 0) {
    const w = await startWorkflow({ projectId: input.projectId, prompt: input.prompt, suggestedKinds });
    return { kind: "workflow", workflowRunId: w.workflowRunId, suggestedKinds, reasoning: verdict.reasoning };
  }

  const r = await startRitual({ projectId: input.projectId, userTurn: input.prompt, editClass: "structural" });
  return { kind: "ritual", ritualId: r.ritualId };
}

function readKindsAllowList(): Set<string> {
  const csv = process.env.ATLAS_FF_WORKFLOW_KINDS;
  if (!csv) return new Set(["frontend-app", "backend-rest-api", "backend-graphql", "tests", "iac", "deploy", "data-pipeline", "mobile-app", "cli-tool"]);
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}
```

- [ ] **Step 2: Tests + commit**

Test matrix: flag off → ritual; flag on + classifier=ritual → ritual; flag on + classifier=workflow + allowed-kinds → workflow; classifier error → ritual fallback; allowed-kinds CSV excludes some → filtered.

```bash
git add apps/atlas-web/lib/actions/startBuild.ts apps/atlas-web/test/actions/startBuild.test.ts
git commit -m "feat(atlas-web): startBuild action — flag-gated entry classifier routing"
```

---

### Task 6: Real WorkflowPlannerRole — triage pass

**Files:**
- Create: `packages/role-workflow-planner/src/triage.ts`
- Test: `packages/role-workflow-planner/test/triage.test.ts`

Modeled on `packages/role-architect/src/triage.ts` — pass-1 LLM call asking blocker questions about ambiguity. Same `triage-clarifications` canvas-pause kind on engine side.

- [ ] **Step 1: Implement** (~50 LOC; mirror role-architect/src/triage.ts structure with planner-specific prompt focusing on: which kinds, dependencies, dependency-profile choices when the prompt is ambiguous)

- [ ] **Step 2: Tests with stub LLM** (returns 0/1/2 blocker questions; verify shape)

- [ ] **Step 3: Commit** (`feat(role-workflow-planner): triage pass with structured ambiguity questions`)

---

### Task 7: WorkflowPlannerRole — DAG synthesis pass

**Files:**
- Create: `packages/role-workflow-planner/src/synthesize-dag.ts`
- Test: `packages/role-workflow-planner/test/synthesize-dag.test.ts`

Pass-2 LLM call. System prompt: "Given the user prompt and clarification answers, emit a DAG of artifact nodes."

Tool schema:

```ts
const SYNTHESIZE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          artifactKind: { type: "string", enum: ["frontend-app", "backend-rest-api", "backend-graphql", "tests", "iac", "deploy"] },
          summary: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          consumes: { type: "array", items: { type: "string" } }
        },
        required: ["id", "artifactKind", "summary", "dependsOn", "consumes"]
      }
    },
    dependencyProfile: { /* DependencyProfile schema as JSON Schema */ },
    reasoning: { type: "string" }
  },
  required: ["nodes", "dependencyProfile", "reasoning"]
};
```

System prompt should embed the OSS-first defaults so the model picks Keycloak/Postgres/MinIO etc. by default unless the user clarification overrode.

- [ ] Implement + test + commit (`feat(role-workflow-planner): DAG synthesis pass with OSS-first profile defaults`)

---

### Task 8: WorkflowPlannerRole — Role.run() composition

**Files:**
- Create: `packages/role-workflow-planner/src/role.ts`
- Test: `packages/role-workflow-planner/test/role.test.ts`

Composes triage + synthesize-dag into a single role following architect's pattern. Emits:
- `workflow_planner.pass1.started` / `pass1.completed` / `triage.needs_input`*
- `workflow_planner.pass2.started` / `pass2.completed`
- `workflow_planner.dag.emitted` (the engine-consumed event)

(* triage event reuses the architect's same triage-clarifications pause kind on the engine side — see Plan A integration.)

- [ ] Implement + test + commit

---

### Task 9: Wire WorkflowPlannerRole into WorkflowEngine

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts` — remove stub-planner usage; expect the real planner to be registered in the conductor
- Modify: `apps/atlas-web/lib/engine/factory.ts` — register `WorkflowPlannerRole` in the conductor; pass the LLM provider

- [ ] **Step 1: factory.ts updates** — `roles.set("workflow-planner", new WorkflowPlannerRole({ llm, ossDefaults: ossFirstDefaults() }))`

- [ ] **Step 2: engine.ts cleanup** — remove stub import; `awaitPlannerDag` now waits for `workflow_planner.dag.emitted` (was `workflow_planner.dag.emitted` for the stub too — coincidence, no change needed)

- [ ] **Step 3: Run Plan A integration test against the real planner** — should still pass with a real-but-stubbed-LLM planner (stub LLM returns canned DAG)

- [ ] **Step 4: Commit** (`feat(workflow-engine): wire real WorkflowPlannerRole; remove stub`)

---

### Task 10: ATLAS_FF_WORKFLOW_PICKER UI hook (server-side flag check only — UI in Plan C)

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts` — add `workflow-picker` + `workflow-kinds`

- [ ] **Step 1: Extend FeatureName union**

```ts
| "workflow-picker"
| "workflow-kinds"   // CSV value flag — `isFeatureEnabled` returns true if set
```

And mapping:
```ts
"workflow-picker": "ATLAS_FF_WORKFLOW_PICKER",
"workflow-kinds": "ATLAS_FF_WORKFLOW_KINDS"
```

- [ ] **Step 2: Commit** (`feat(atlas-web): add workflow-picker + workflow-kinds feature flags`)

Note: the picker UI itself lives in Plan C (Graph view).

---

### Task 11: End-to-end test through real planner

**Files:**
- Modify: `packages/workflow-engine/test/integration.test.ts`

Add a test case: with the real `WorkflowPlannerRole` + stub LLM that returns a 3-node DAG (backend → frontend, tests depends on both), the planner emits the DAG, the engine awaits approval (simulated programmatically via `engine.approvePlan()`), then runs through.

- [ ] Implement + commit

---

## Plan B — Self-review checklist

- [ ] Spec section 3 (lifecycle plan phase) → Tasks 6, 7, 8 (real planner)
- [ ] Spec section 9 (entry classifier + flags) → Tasks 4, 5, 10
- [ ] Spec section 12 (DependencyProfile) → Tasks 2, 3, 7 (profile in synthesis prompt)
- [ ] Spec section 9 (fail-safe to single-ritual) → Task 5 (catch + fallback in startBuild)

**Shippable result:** Real prompts get classified and either route to single-ritual or to a workflow with a real planner-emitted DAG. The picker checklist UI lands in Plan C. Workflows still execute against stub roles for kinds beyond `frontend-app` until Plans D/E/F implement them.
