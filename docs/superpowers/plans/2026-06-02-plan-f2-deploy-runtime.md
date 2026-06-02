# Plan F.2 — Deploy Runtime Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Plan F's `DeployArtifact` + `IacArtifact` into the existing `DeployOrchestrator` (C-1) so flag-gated workflow deploys actually apply K8s manifests + DNS and surface a live publicUrl. Flag-off path preserves Plan F's producer-only behavior unchanged.

**Architecture:** New `deployFromArtifacts` method on `DeployOrchestrator` reuses kubernetes-client + cloudflare-client + reconcile + rollback. Workflow engine gets a post-producer hook for deploy-kind nodes that calls into it when `ATLAS_FF_DEPLOY_RUNTIME=true`. The result lands on the workflow node as `deployResult`. `DeployCanvas` surfaces the live phase+URL when present.

**Tech Stack:** TypeScript pnpm monorepo, `@kubernetes/client-node` (already a deploy-orchestrator dep), `js-yaml` (already a dep) for namespace extraction.

**Spec reference:** `docs/superpowers/specs/2026-06-02-plan-f2-deploy-runtime-design.md`

**Depends on:** Plans A–G + D.2 merged. Branch off current `main` (`64c91f8`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` | Pure-ish `runDeployFromArtifacts(opts, input)` function applying artifact manifests via kubernetes-client + cloudflare-client + reconcile + rollback |
| `packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts` | Tests via in-memory clients |
| `packages/workflow-engine/test/integration-deploy-runtime.test.ts` | End-to-end: deploy node producer → engine calls deployFromArtifacts → result on node |

### Modified files
| File | Change |
|---|---|
| `packages/deploy-orchestrator/src/orchestrator.ts` | Add `deployFromArtifacts(input)` method that delegates to the new module |
| `packages/deploy-orchestrator/src/index.ts` | Export `DeployFromArtifactsInput`, `DeployFromArtifactsResult` |
| `packages/workflow-engine/src/types.ts` | Optional `deployResult?: { publicUrl, argoApplicationName, phase, deployId, startedAt }` on `WorkflowNodeSchema` |
| `packages/workflow-engine/src/engine.ts` | New optional `deployRunner?: (input) => Promise<DeployRunnerResult>` on `WorkflowEngineOptions`; post-producer hook for deploy-kind nodes |
| `apps/atlas-web/lib/engine/factory.ts` | Construct DeployOrchestrator from env (when flag on); wrap as `deployRunner` and inject |
| `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` | When `artifact.deployResult` is set, show publicUrl + phase + Argo app name instead of (or alongside) the F.2 banner |

---

## Tasks

### Task 1: `runDeployFromArtifacts` pure helper

**Files:**
- Create: `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`
- Create: `packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts`

The function does:
1. `branching.ensureBranch(projectId, branchId)` — DB schema-per-branch (existing port)
2. If new, `migrate({ schemaName })` (existing port)
3. For each `iacArtifact.k8s.manifests[]`: parse the YAML to extract `metadata.namespace` (fallback `"atlas-projects"`); `kubernetes.apply(namespace, m.kind, m.name, m.content)`
4. `kubernetes.apply("argocd", "Application", deployArtifact.argoApplication.name, deployArtifact.argoApplication.content)`
5. `cloudflare.upsertDnsRecord(apex, fqdn, "CNAME", ingressTarget)`
6. `reconcileArgoUntilSettled(kubernetes, argoApplication.name, {interval, timeout})`
7. On not-healthy: rollback (delete every applied manifest in REVERSE order + delete DNS), throw
8. On healthy: return `DeployFromArtifactsResult` with publicUrl + applied list

- [ ] **Step 1: Investigate**

```bash
cat F:/claude/ai_builder/packages/deploy-orchestrator/src/orchestrator.ts | head -120
cat F:/claude/ai_builder/packages/deploy-orchestrator/src/reconcile.ts | head -40
cat F:/claude/ai_builder/packages/deploy-orchestrator/src/types.ts
```

Note the existing `DeployRequestSchema`, `BranchingPort`, `MigratePort`, `KubernetesClient`, `CloudflareClient` shapes. Reuse them.

- [ ] **Step 2: Failing test** at `packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { runDeployFromArtifacts } from "../src/deploy-from-artifacts.js";
import type { IacArtifact, DeployArtifact } from "@atlas/workflow-engine";

const IAC: IacArtifact = {
  schemaVersion: "1",
  kind: "iac",
  compose: { file: "docker-compose.yml", content: "version: '3'" },
  k8s: {
    manifests: [
      { file: "k8s/svc.yaml", kind: "Service", name: "api",
        content: "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n  namespace: atlas-projects\nspec: {}" },
      { file: "k8s/cert.yaml", kind: "Certificate", name: "wildcard",
        content: "apiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata:\n  name: wildcard\nspec: {}" }
    ]
  },
  services: [],
  imageRegistry: { url: "reg.local", namespace: "proj-1" }
};

const DEPLOY: DeployArtifact = {
  schemaVersion: "1",
  kind: "deploy",
  target: "k8s",
  argoApplication: { file: "argo/app.yaml", name: "proj-1-main", repoUrl: "git@x:y.git", path: "k8s/",
    content: "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec: {}" },
  imageBuilds: [],
  smokeTests: []
};

function makeOpts() {
  const kubernetes = new InMemoryKubernetesClient();
  const cloudflare = new InMemoryCloudflareClient();
  return {
    kubernetes,
    cloudflare,
    branching: {
      ensureBranch: async (_p: string, b: string) => ({ created: true, schemaName: `branch_${b}` })
    },
    migrate: async () => {},
    ingressTarget: "ingress.example.com",
    reconcileIntervalMs: 1,
    reconcileTimeoutMs: 50
  };
}

describe("runDeployFromArtifacts", () => {
  it("applies every k8s manifest + argo app via kubernetes-client", async () => {
    const opts = makeOpts();
    // Mark Argo healthy immediately
    opts.kubernetes._setHealth?.("proj-1-main", "Healthy");
    const r = await runDeployFromArtifacts(opts, {
      projectId: "p-1",
      branchId: "main",
      subdomain: "proj-1",
      apex: "atlas.dev",
      iacArtifact: IAC,
      deployArtifact: DEPLOY
    });
    expect(r.phase).toBe("healthy");
    expect(r.publicUrl).toBe("https://proj-1.atlas.dev");
    expect(r.argoApplicationName).toBe("proj-1-main");
    expect(r.appliedManifests).toHaveLength(3); // 2 iac + 1 argo
  });

  it("rolls back applied manifests + DNS when Argo reports unhealthy", async () => {
    const opts = makeOpts();
    opts.kubernetes._setHealth?.("proj-1-main", "Degraded");
    await expect(runDeployFromArtifacts(opts, {
      projectId: "p-1", branchId: "main", subdomain: "proj-1", apex: "atlas.dev",
      iacArtifact: IAC, deployArtifact: DEPLOY
    })).rejects.toThrow(/deploy.*rolled back|Degraded/i);
    // All applied manifests should be deleted
    expect(opts.kubernetes._store?.size ?? 0).toBe(0);
  });

  it("ensures the DB branch + runs migrate when branch is newly created", async () => {
    const migrate = vi.fn();
    const opts = { ...makeOpts(), migrate };
    opts.kubernetes._setHealth?.("proj-1-main", "Healthy");
    await runDeployFromArtifacts(opts, {
      projectId: "p-1", branchId: "main", subdomain: "proj-1", apex: "atlas.dev",
      iacArtifact: IAC, deployArtifact: DEPLOY
    });
    expect(migrate).toHaveBeenCalledWith({ schemaName: "branch_main" });
  });

  it("skips migrate when branch already exists", async () => {
    const migrate = vi.fn();
    const opts = {
      ...makeOpts(),
      branching: { ensureBranch: async () => ({ created: false, schemaName: "branch_main" }) },
      migrate
    };
    opts.kubernetes._setHealth?.("proj-1-main", "Healthy");
    await runDeployFromArtifacts(opts, {
      projectId: "p-1", branchId: "main", subdomain: "proj-1", apex: "atlas.dev",
      iacArtifact: IAC, deployArtifact: DEPLOY
    });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("upserts DNS via cloudflare-client", async () => {
    const opts = makeOpts();
    opts.kubernetes._setHealth?.("proj-1-main", "Healthy");
    await runDeployFromArtifacts(opts, {
      projectId: "p-1", branchId: "main", subdomain: "proj-1", apex: "atlas.dev",
      iacArtifact: IAC, deployArtifact: DEPLOY
    });
    const dns = opts.cloudflare._records?.get("atlas.dev/proj-1.atlas.dev");
    expect(dns).toBeDefined();
  });
});
```

Note: `_setHealth`, `_store`, `_records` are test seams on the existing `InMemoryKubernetesClient` / `InMemoryCloudflareClient` — confirm they exist by reading their source. If they're named differently, adapt.

- [ ] **Step 3:** Run, expect failure:
```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test deploy-from-artifacts
```

- [ ] **Step 4: Implement** `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`:

```ts
import { randomUUID } from "node:crypto";
import { load as parseYaml } from "js-yaml";
import type { IacArtifact, DeployArtifact } from "@atlas/workflow-engine";
import type { KubernetesClient } from "./kubernetes-client.js";
import type { CloudflareClient } from "./cloudflare-client.js";
import type { BranchingPort, MigratePort } from "./orchestrator.js";
import { reconcileArgoUntilSettled } from "./reconcile.js";
import { DeployError } from "./errors.js";

export interface DeployFromArtifactsOptions {
  kubernetes: KubernetesClient;
  cloudflare: CloudflareClient;
  branching: BranchingPort;
  migrate: MigratePort;
  ingressTarget: string;
  reconcileIntervalMs?: number;
  reconcileTimeoutMs?: number;
}

export interface DeployFromArtifactsInput {
  projectId: string;
  branchId: string;
  subdomain: string;
  apex: string;
  iacArtifact: IacArtifact;
  deployArtifact: DeployArtifact;
}

export interface DeployFromArtifactsResult {
  deployId: string;
  publicUrl: string;
  argoApplicationName: string;
  branchSchemaName: string;
  appliedManifests: Array<{ namespace: string; kind: string; name: string }>;
  phase: "healthy" | "failed";
  startedAt: string;
}

const DEFAULT_NAMESPACE = "atlas-projects";
const ARGO_NAMESPACE = "argocd";

function extractNamespace(manifestYaml: string): string {
  try {
    const doc = parseYaml(manifestYaml) as { metadata?: { namespace?: unknown } } | null;
    const ns = doc?.metadata?.namespace;
    return typeof ns === "string" && ns.length > 0 ? ns : DEFAULT_NAMESPACE;
  } catch {
    return DEFAULT_NAMESPACE;
  }
}

export async function runDeployFromArtifacts(
  opts: DeployFromArtifactsOptions,
  input: DeployFromArtifactsInput
): Promise<DeployFromArtifactsResult> {
  const deployId = randomUUID();
  const startedAt = new Date().toISOString();
  const fqdn = `${input.subdomain}.${input.apex}`;

  const branch = await opts.branching.ensureBranch(input.projectId, input.branchId);
  if (branch.created) {
    await opts.migrate({ schemaName: branch.schemaName });
  }

  const applied: Array<{ namespace: string; kind: string; name: string }> = [];

  try {
    // Apply IaC k8s manifests
    for (const m of input.iacArtifact.k8s.manifests) {
      const ns = extractNamespace(m.content);
      await opts.kubernetes.apply(ns, m.kind, m.name, m.content);
      applied.push({ namespace: ns, kind: m.kind, name: m.name });
    }

    // Apply Argo CD Application
    await opts.kubernetes.apply(
      ARGO_NAMESPACE,
      "Application",
      input.deployArtifact.argoApplication.name,
      input.deployArtifact.argoApplication.content
    );
    applied.push({
      namespace: ARGO_NAMESPACE,
      kind: "Application",
      name: input.deployArtifact.argoApplication.name
    });

    // DNS
    await opts.cloudflare.upsertDnsRecord(input.apex, fqdn, "CNAME", opts.ingressTarget);

    // Reconcile Argo health
    const health = await reconcileArgoUntilSettled(
      opts.kubernetes,
      input.deployArtifact.argoApplication.name,
      {
        intervalMs: opts.reconcileIntervalMs ?? 200,
        timeoutMs: opts.reconcileTimeoutMs ?? 60_000
      }
    );

    if (health !== "Healthy") {
      // Roll back
      await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
      for (const m of [...applied].reverse()) {
        await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
      }
      throw new DeployError(
        `argo Application ${input.deployArtifact.argoApplication.name} reported ${health}; deployment rolled back`
      );
    }

    return {
      deployId,
      publicUrl: `https://${fqdn}`,
      argoApplicationName: input.deployArtifact.argoApplication.name,
      branchSchemaName: branch.schemaName,
      appliedManifests: applied,
      phase: "healthy",
      startedAt
    };
  } catch (err) {
    // On any failure mid-apply, roll back what we already applied + DNS
    await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
    for (const m of [...applied].reverse()) {
      await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
    }
    throw err;
  }
}
```

- [ ] **Step 5:** Export from `packages/deploy-orchestrator/src/index.ts`:

```ts
export {
  runDeployFromArtifacts,
  type DeployFromArtifactsInput,
  type DeployFromArtifactsResult,
  type DeployFromArtifactsOptions
} from "./deploy-from-artifacts.js";
```

- [ ] **Step 6: Run + typecheck + commit:**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator/src/deploy-from-artifacts.ts packages/deploy-orchestrator/src/index.ts packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts
git commit -m "feat(deploy-orchestrator): runDeployFromArtifacts — apply Plan F artifacts via existing k8s/cloudflare clients (Plan F.2 Task 1)"
```

NOTE: `@atlas/workflow-engine` types must be importable from `@atlas/deploy-orchestrator`. Check `deploy-orchestrator/package.json` deps; if `@atlas/workflow-engine` isn't there, add `"@atlas/workflow-engine": "workspace:*"` and `pnpm install`.

---

### Task 2: `DeployOrchestrator.deployFromArtifacts` method

**Files:**
- Modify: `packages/deploy-orchestrator/src/orchestrator.ts`

Add a thin method on the class that delegates to the new module:

- [ ] **Step 1:** Open `orchestrator.ts`. Add at the bottom of the class:

```ts
async deployFromArtifacts(input: DeployFromArtifactsInput): Promise<DeployFromArtifactsResult> {
  return runDeployFromArtifacts({
    kubernetes: this.opts.kubernetes,
    cloudflare: this.opts.cloudflare,
    branching: this.opts.branching,
    migrate: this.opts.migrate,
    ingressTarget: this.opts.ingressTarget,
    ...(this.opts.reconcileIntervalMs !== undefined ? { reconcileIntervalMs: this.opts.reconcileIntervalMs } : {}),
    ...(this.opts.reconcileTimeoutMs !== undefined ? { reconcileTimeoutMs: this.opts.reconcileTimeoutMs } : {})
  }, input);
}
```

Add the import:
```ts
import {
  runDeployFromArtifacts,
  type DeployFromArtifactsInput,
  type DeployFromArtifactsResult
} from "./deploy-from-artifacts.js";
```

- [ ] **Step 2:** Add a focused test asserting `DeployOrchestrator.deployFromArtifacts` delegates correctly. Inline-mock by constructing a real `DeployOrchestrator` with in-memory clients + asserting end-to-end through the method.

- [ ] **Step 3:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
git add packages/deploy-orchestrator/src/orchestrator.ts
git commit -m "feat(deploy-orchestrator): DeployOrchestrator.deployFromArtifacts method (Plan F.2 Task 2)"
```

---

### Task 3: Workflow-engine `deployResult` field + types

**Files:**
- Modify: `packages/workflow-engine/src/types.ts`
- Create: `packages/workflow-engine/test/types-deploy-result.test.ts`

- [ ] **Step 1: Failing test** asserts WorkflowNodeSchema accepts/rejects `deployResult` correctly:

```ts
import { describe, it, expect } from "vitest";
import { WorkflowNodeSchema } from "../src/types.js";

describe("WorkflowNodeSchema — deployResult field (Plan F.2)", () => {
  const base = {
    id: "deploy", artifactKind: "deploy", summary: "deploy",
    dependsOn: ["iac"], consumes: ["iac"],
    policy: { priority: 0, runMode: "active" as const }, status: "done" as const
  };
  it("accepts a valid deployResult", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "https://proj-1.atlas.dev",
        argoApplicationName: "proj-1-main", branchSchemaName: "branch_main",
        appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
        phase: "healthy", startedAt: "2026-01-01T00:00:00.000Z"
      }
    });
    expect(r.success).toBe(true);
  });
  it("accepts omitted deployResult (default state)", () => {
    expect(WorkflowNodeSchema.safeParse(base).success).toBe(true);
  });
  it("rejects an invalid publicUrl", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "not-a-url",
        argoApplicationName: "x", branchSchemaName: "x",
        appliedManifests: [], phase: "healthy", startedAt: "x"
      }
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2:** Add the field to `WorkflowNodeSchema` in `types.ts`:

```ts
const DeployResultSchema = z.object({
  deployId: z.string().min(1),
  publicUrl: z.string().url(),
  argoApplicationName: z.string().min(1),
  branchSchemaName: z.string().min(1),
  appliedManifests: z.array(z.object({
    namespace: z.string().min(1),
    kind: z.string().min(1),
    name: z.string().min(1)
  })),
  phase: z.enum(["healthy", "failed"]),
  startedAt: z.string()
});

// Inside WorkflowNodeSchema:
deployResult: DeployResultSchema.optional()
```

Also export the type:
```ts
export type DeployResult = z.infer<typeof DeployResultSchema>;
```

- [ ] **Step 3:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine
git commit -m "feat(workflow-engine): WorkflowNode.deployResult field + DeployResult type (Plan F.2 Task 3)"
```

---

### Task 4: Workflow-engine post-producer deploy hook

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts`
- Create: `packages/workflow-engine/test/engine-deploy-runtime.test.ts`

Add an optional `deployRunner?: (input) => Promise<DeployResult>` to `WorkflowEngineOptions`. When set AND a deploy-kind node's ritual emits a valid DeployArtifact, the engine calls `deployRunner(input)` AFTER the artifact is persisted, AND BEFORE marking the node `done`. The result is stored as `node.deployResult`.

The `deployRunner` input shape:
```ts
{
  workflowRunId: string;
  projectId: string;
  nodeId: string;
  iacArtifact: IacArtifact;          // from upstream merge
  deployArtifact: DeployArtifact;    // the just-emitted artifact
  // metadata extracted by the engine OR passed via WorkflowEngineOptions:
  branchId: string;                  // typically workflowRunId-derived
  subdomain: string;                 // typically nodeId or project subdomain
  apex: string;                      // env-config; from engine options
}
```

For Plan F.2 v1: `branchId = workflowRunId`, `subdomain = first 8 chars of workflowRunId`, `apex` comes from a new `WorkflowEngineOptions.deployApex?: string` field.

- [ ] **Step 1: Failing test** at `packages/workflow-engine/test/engine-deploy-runtime.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import "../src/artifact-contracts/iac.js";
import "../src/artifact-contracts/deploy.js";
import { WorkflowEngine, type IRitualEngine } from "../src/engine.js";

// Paste makeRunRepo + makeNodeRepo.
// (Or import from a shared fixtures module.)

const VALID_DEPLOY_RESULT = {
  deployId: "d-1",
  publicUrl: "https://proj.atlas.dev",
  argoApplicationName: "proj-main",
  branchSchemaName: "branch_main",
  appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
  phase: "healthy" as const,
  startedAt: "2026-01-01T00:00:00.000Z"
};

describe("Plan F.2 — deploy runtime hook", () => {
  it("calls deployRunner when a deploy node's ritual emits a DeployArtifact + flag is on", async () => {
    const deployRunner = vi.fn(async () => VALID_DEPLOY_RESULT);
    // Build a fake ritual engine that emits valid IacArtifact for the iac node, DeployArtifact for the deploy node.
    // ... (mirror integration-iac-deploy-handoff.test.ts)
    // Seed run + 2 nodes (iac → deploy). Approve. Wait for scheduler.
    // Assert deployRunner was called with the right inputs.
    // Assert node.deployResult was persisted.
  });

  it("does NOT call deployRunner when deployRunner is not provided", async () => {
    // Same scenario without deployRunner option; verify the artifact persists but node has no deployResult.
  });

  it("marks the node failed when deployRunner throws", async () => {
    const deployRunner = vi.fn(async () => { throw new Error("argo Application proj-main reported Degraded; deployment rolled back"); });
    // Same setup; assert node.status === "failed", node.failure.error contains rollback text.
  });
});
```

- [ ] **Step 2:** Implement the hook in engine.ts. Find the place where a node ritual is awaited + completed; before marking `done`, if `artifactKind === "deploy"` AND `deployRunner` is provided AND the artifact is a valid DeployArtifact, call `deployRunner(...)`. On success, persist `deployResult`; on throw, mark the node failed.

The engine needs to:
- Look up upstream IacArtifact from priorArtifact.upstream (find the entry whose `kind === "iac"`)
- Build the deployRunner input with branchId/subdomain/apex
- Call `deployRunner(input)`
- `nodeRepo.setArtifact(workflowRunId, nodeId, ...)` already exists for artifacts; you'll need a similar persistence path for `deployResult` — extend nodeRepo + IWorkflowNodeRepo with `setDeployResult` OR persist via a generic `setNodeField` mechanism

- [ ] **Step 3:** Run + commit (full test suite green; pre-existing 8 integration-DB failures still expected):

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine
git commit -m "feat(workflow-engine): post-producer deploy hook calls deployRunner for deploy-kind nodes (Plan F.2 Task 4)"
```

---

### Task 5: Atlas-web factory wiring (DeployOrchestrator + feature flag)

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`

When `ATLAS_FF_DEPLOY_RUNTIME=true`:
- Construct kubernetes-client + cloudflare-client + branching + migrate (these may already exist in the codebase from C-1; check)
- Construct DeployOrchestrator from those + env (manifestRepoUrl, issuerRef, ingressTarget)
- Pass `deployRunner` to the WorkflowEngine that calls `orchestrator.deployFromArtifacts(input)` and maps the result

When flag is off, don't inject deployRunner. WorkflowEngine's hook is no-op.

- [ ] **Step 1:** Investigate the existing C-1 wiring (it may exist in atlas-web already)

```bash
grep -rn "DeployOrchestrator\|KubernetesClient\|CloudflareClient" apps/atlas-web/lib 2>&1 | head -10
```

If existing wiring is there, REUSE it. If not, build a new constructor that reads env (`ATLAS_DEPLOY_KUBE_CONFIG`, `ATLAS_DEPLOY_INGRESS_TARGET`, `ATLAS_DEPLOY_APEX`, `ATLAS_DEPLOY_MANIFEST_REPO_URL`, `ATLAS_DEPLOY_ISSUER_REF`, `ATLAS_CLOUDFLARE_TOKEN`, `ATLAS_CLOUDFLARE_ZONE_ID`).

For Plan F.2 v1: when the flag is on but env vars are missing, throw at engine-construction time with a clear "please configure deploy env vars" error. Don't silently no-op.

- [ ] **Step 2:** Add an integration test that just verifies the factory wires `deployRunner` when the flag is on + doesn't when it's off. Mock the env reads.

- [ ] **Step 3:** Commit:

```bash
git add apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): factory wires DeployOrchestrator + deployRunner under ATLAS_FF_DEPLOY_RUNTIME flag (Plan F.2 Task 5)"
```

---

### Task 6: DeployCanvas — surface deploy result

**Files:**
- Modify: `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx`
- Modify: `apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx`

The current DeployCanvas reads `artifact` and shows "execution lands in F.2". After Plan F.2 ships, when the workflow node has a `deployResult` set, the canvas should:
- Show a green "deployed" header with `publicUrl` as a clickable link
- Show the Argo Application name
- Show the count of applied manifests
- Hide the F.2 banner

Existing rendering (image builds, smoke tests, etc.) still shows below as context.

The component currently takes `artifact?: DeployArtifact`. Add an optional `deployResult?: DeployResult` prop. The drill-in page (or wherever it's mounted) passes both.

- [ ] **Step 1: Failing test** — render DeployCanvas with `deployResult` set + assert the green deployed-header is shown with the publicUrl.

- [ ] **Step 2:** Implement. Update the page route too (`apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/node/[nodeId]/page.tsx` or wherever DeployCanvas mounts) to pass `node.deployResult` from the snapshot.

- [ ] **Step 3:** Run + commit:

```bash
git add apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx \
        apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx
git commit -m "feat(atlas-web): DeployCanvas surfaces deploy runtime result (publicUrl, Argo app) when present (Plan F.2 Task 6)"
```

---

### Task 7: End-to-end integration test

**Files:**
- Create: `packages/workflow-engine/test/integration-deploy-runtime.test.ts`

Mirror Plan F's `integration-iac-deploy-handoff.test.ts` but with a `deployRunner` injected. The runner is a spy that returns `VALID_DEPLOY_RESULT`. Assertions:

1. Deploy node's `start()` was called with the iac upstream
2. `deployRunner` was called with the expected input (workflowRunId, nodeId, iacArtifact, deployArtifact)
3. Node's `deployResult` matches what the runner returned
4. Node ended as `done` (not failed)

- [ ] **Step 1:** Write the test.
- [ ] **Step 2:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test integration-deploy-runtime
git add packages/workflow-engine/test/integration-deploy-runtime.test.ts
git commit -m "test(workflow-engine): end-to-end deploy runtime hook applies artifact (Plan F.2 Task 7)"
```

---

## Plan F.2 — Self-review checklist

- [ ] Spec §"Approach A" → Tasks 1, 2
- [ ] Spec §"Workflow-engine wiring" → Tasks 3, 4
- [ ] Spec §"Flag default off" → Task 5
- [ ] Spec §"Surface runtime result" → Task 6
- [ ] Spec §"End-to-end test" → Task 7

**Shippable result:** With `ATLAS_FF_DEPLOY_RUNTIME=true` and configured env (kubernetes config, cloudflare creds, ingress target, apex), a workflow's deploy node actually deploys its artifact: K8s manifests applied via the existing kubernetes-client, Argo Application created, DNS upserted via cloudflare-client, Argo health reconciled, public URL shown in `DeployCanvas`. Failures roll back cleanly and surface on the node. Without the flag, today's Plan F producer-only behavior is preserved unchanged.
