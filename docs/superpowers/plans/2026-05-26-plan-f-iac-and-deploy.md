# Plan F — `iac` + `deploy` Artifact Kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop from prompt to deployed stack. v1 target = docker-compose only: `role-iac` emits a compose file declaring services for every upstream runtime node; `role-deployer` brings up the compose stack in a fresh sandbox and runs smoke tests. Cloud targets (Fly/Render/k8s) are out of scope.

**Architecture:** Two new role packages + one new sandbox template. `role-iac`: reads upstream backend/frontend artifacts + the workflow's DependencyProfile, emits a `docker-compose.yml` whose services reference the upstream sandbox URLs / env contracts. `role-deployer`: provisions a `atlas-iac-compose` sandbox, applies the compose diff, runs `docker compose up -d`, hits the smoke URLs, records pass/fail. Two new per-node renderers: `IacTopologyRenderer` (service graph) and `DeployStatusRenderer` (service status + smoke results).

**Tech Stack:** Same. New sandbox template: `atlas-iac-compose` (Ubuntu + docker-in-docker).

**Spec reference:** Section 4, Section 10 (`iac` + `deploy` rows).

**Depends on:** Plans A + B + C + D + E merged.

---

## File Structure

### New packages
| Path | Purpose |
|---|---|
| `packages/role-iac/` | Emits compose file from upstream artifacts |
| `packages/role-deployer/` | Brings up compose stack + smoke tests |

### New sandbox template
| Path | Purpose |
|---|---|
| `packages/sandbox-e2b/templates/atlas-iac-compose/` | Ubuntu base image with docker-in-docker, docker compose CLI, curl for smoke tests |

### New artifact-contract schemas
| Path | Purpose |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/iac.ts` | `IacArtifactSchema` |
| `packages/workflow-engine/src/artifact-contracts/deploy.ts` | `DeployArtifactSchema` |

### New renderers
| Path | Purpose |
|---|---|
| `apps/atlas-web/components/workflow/renderers/IacTopologyRenderer.tsx` | Service graph (small svg + the compose file in Monaco) |
| `apps/atlas-web/components/workflow/renderers/DeployStatusRenderer.tsx` | Service up/down + smoke results table |

### Modifications
| File | Change |
|---|---|
| `apps/atlas-web/lib/engine/factory.ts` | Register `IacRole` + `DeployerRole` |
| `packages/role-workflow-planner/src/synthesize-dag.ts` | Planner adds `iac` + `deploy` nodes when prompt implies hosting (e.g., "deploy", "self-host", "production-ready"); deferred by default to keep simple workflows simple |
| `apps/atlas-web/components/canvas/register-renderers.ts` | Replace Plan C stubs for iac + deploy |

---

## Tasks

### Task 1: IacArtifactSchema + DeployArtifactSchema

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/iac.ts`
- Create: `packages/workflow-engine/src/artifact-contracts/deploy.ts`
- Test: corresponding test files

```ts
// iac.ts
export const IacResourceSchema = z.object({
  kind: z.string(),                // "service" | "network" | "volume"
  name: z.string(),
  file: z.string()                 // path of the file declaring this resource (usually "docker-compose.yml")
});

export const IacArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("iac"),
  tool: z.literal("compose"),      // v1 only
  resources: z.array(IacResourceSchema).min(1),
  envContract: z.array(EnvVarSchema),
  topology: z.object({
    services: z.array(z.object({
      name: z.string(),
      image: z.string(),
      ports: z.array(z.string()),
      dependsOn: z.array(z.string()).default([])
    })),
    networks: z.array(z.string()).default([])
  })
});

// deploy.ts
export const SmokeTestSchema = z.object({
  url: z.string().url(),
  expect: z.object({
    statusCode: z.number().int().min(100).max(599).optional(),
    bodyContains: z.string().optional()
  })
});

export const DeployArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("deploy"),
  target: z.literal("docker-compose"),
  manifests: z.array(z.object({ file: z.string(), kind: z.string() })),
  smokeTests: z.array(SmokeTestSchema),
  smokeResults: z.array(z.object({
    url: z.string(),
    statusCode: z.number().optional(),
    passed: z.boolean(),
    errorMessage: z.string().optional()
  }))
});
```

- [ ] Implement + register + test + commit (`feat(workflow-engine): IacArtifactSchema + DeployArtifactSchema`)

---

### Task 2: Sandbox template atlas-iac-compose

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-iac-compose/Dockerfile`
- Create: `packages/sandbox-e2b/templates/atlas-iac-compose/e2b.toml`
- Create: `packages/sandbox-e2b/templates/atlas-iac-compose/README.md`

The image needs: docker-in-docker, docker compose v2 plugin, curl, jq.

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    ca-certificates curl gnupg lsb-release jq \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
CMD ["bash"]
```

- [ ] **Step 2: e2b.toml (mirror other templates' format)**

```toml
template_id = "atlas-iac-compose"
template_name = "atlas-iac-compose"
dockerfile = "Dockerfile"
cpu_count = 2
memory_mb = 2048
```

- [ ] **Step 3: Build + publish template** (per existing template-publishing instructions in `docs/superpowers/E2B-TEMPLATE-PUBLISH.md` if present, else via `e2b template build`)

- [ ] **Step 4: Commit** (`feat(sandbox-e2b): atlas-iac-compose template (docker compose runtime)`)

---

### Task 3: Scaffold packages/role-iac

Standard scaffold (mirror Plan A Task 1).

- [ ] Scaffold + commit

---

### Task 4: IacRole — compose file synthesis

**Files:**
- Create: `packages/role-iac/src/role.ts`
- Create: `packages/role-iac/src/synthesize-compose.ts`
- Test: `packages/role-iac/test/synthesize-compose.test.ts`

The LLM call. System prompt: "Given upstream backend/frontend artifacts + dependencyProfile, emit a docker-compose.yml plus the IacArtifact metadata."

Tool schema includes:
- `diff` (unified diff creating `docker-compose.yml`)
- `topology` (parsed structure)
- `envContract`
- `resources` (list)

The prompt should:
- Declare a service per upstream runtime artifact (backend → fastapi service; frontend → nginx serving static OR node service running `pnpm start`)
- Map ports from the upstream artifact's `previewUrl` if available
- Include services for the dependencyProfile (postgres, keycloak, minio, etc.) — exactly the providers selected in the profile
- Wire dependsOn between services (backend depends_on postgres; frontend depends_on backend)

- [ ] Implement + test + commit (`feat(role-iac): synthesize docker-compose.yml from upstream + profile`)

---

### Task 5: IacRole composition + gate

**Files:**
- Create: `packages/role-iac/src/role.ts`
- Test: `packages/role-iac/test/role.test.ts`

After the LLM call, the role validates the compose file syntactically by spinning up a tiny sandbox (or via local `docker compose config` if running in a container that has docker). For Plan F v1, do the validation INSIDE the eventual deployer sandbox — too expensive to spin up a second sandbox just to validate.

Just emits the artifact via tool output; the deployer will catch syntax errors at apply time.

- [ ] Implement + commit (`feat(role-iac): IacRole composition (compose-only v1)`)

---

### Task 6: Scaffold packages/role-deployer

Standard scaffold.

- [ ] Scaffold + commit

---

### Task 7: DeployerRole

**Files:**
- Create: `packages/role-deployer/src/role.ts`
- Create: `packages/role-deployer/src/bring-up-compose.ts`
- Create: `packages/role-deployer/src/run-smoke-tests.ts`
- Test: corresponding tests

- [ ] **Step 1: bring-up-compose**

```ts
// bring-up-compose.ts
import type { SandboxExec } from "@atlas/sandbox-e2b";

export interface BringUpResult {
  ok: boolean;
  servicesUp: string[];
  servicesFailed: Array<{ name: string; error: string }>;
  logs: string;
}

export async function bringUpCompose(sandbox: SandboxExec, composeDiff: string): Promise<BringUpResult> {
  // 1. Apply the diff (writes docker-compose.yml + any sidecar files)
  await applyDiffInSandbox(sandbox, composeDiff);

  // 2. Start docker daemon (the iac-compose template runs DinD)
  await sandbox.runCommand({ cmd: "service docker start || true", timeoutMs: 15_000 });
  await sandbox.runCommand({ cmd: "sleep 3 && docker info > /dev/null", timeoutMs: 30_000 });

  // 3. Bring up
  const upResult = await sandbox.runCommand({
    cmd: "cd /workspace && docker compose up -d --wait",
    timeoutMs: 300_000
  });
  if (upResult.exitCode !== 0) {
    return { ok: false, servicesUp: [], servicesFailed: [{ name: "(unknown)", error: upResult.stderr }], logs: upResult.stdout };
  }

  // 4. List services
  const ps = await sandbox.runCommand({
    cmd: "cd /workspace && docker compose ps --format json",
    timeoutMs: 30_000
  });
  const services = parseComposePs(ps.stdout);
  return {
    ok: services.every((s) => s.state === "running"),
    servicesUp: services.filter((s) => s.state === "running").map((s) => s.name),
    servicesFailed: services.filter((s) => s.state !== "running").map((s) => ({ name: s.name, error: s.state })),
    logs: ps.stdout
  };
}
```

- [ ] **Step 2: run-smoke-tests**

```ts
import type { SmokeTest } from "@atlas/workflow-engine";

export async function runSmokeTests(sandbox: SandboxExec, smokeTests: SmokeTest[]): Promise<Array<{ url: string; statusCode?: number; passed: boolean; errorMessage?: string }>> {
  const results: Array<{ url: string; statusCode?: number; passed: boolean; errorMessage?: string }> = [];
  for (const t of smokeTests) {
    const cmd = `curl -sS -o /tmp/body -w "%{http_code}" --max-time 15 ${shellQuote(t.url)}`;
    const r = await sandbox.runCommand({ cmd, timeoutMs: 20_000 });
    const statusCode = parseInt(r.stdout.trim(), 10);
    let passed = r.exitCode === 0;
    let err: string | undefined;
    if (passed && t.expect.statusCode !== undefined && statusCode !== t.expect.statusCode) {
      passed = false; err = `expected ${t.expect.statusCode}, got ${statusCode}`;
    }
    if (passed && t.expect.bodyContains) {
      const body = await sandbox.runCommand({ cmd: "cat /tmp/body", timeoutMs: 5_000 });
      if (!body.stdout.includes(t.expect.bodyContains)) {
        passed = false; err = `body did not contain "${t.expect.bodyContains}"`;
      }
    }
    results.push({ url: t.url, statusCode, passed, ...(err ? { errorMessage: err } : {}) });
  }
  return results;
}
```

- [ ] **Step 3: DeployerRole composition + tests + commit**

```bash
git commit -m "feat(role-deployer): bring up compose + run smoke tests; DeployerRole composition"
```

---

### Task 8: Register roles + planner awareness

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts` — register `IacRole` + `DeployerRole`
- Modify: `packages/role-workflow-planner/src/synthesize-dag.ts` — extend prompt: "When the user prompt implies hosting/deployment/self-hosting, add `iac` and `deploy` nodes. Otherwise leave them deferred so the user can add them later."

- [ ] Implement + commit

---

### Task 9: IacTopologyRenderer + DeployStatusRenderer

**Files:**
- Create: `apps/atlas-web/components/workflow/renderers/IacTopologyRenderer.tsx` — renders the `topology` (services as boxes with arrows for dependsOn) + the compose file in a collapsible Monaco panel
- Create: `apps/atlas-web/components/workflow/renderers/DeployStatusRenderer.tsx` — shows `servicesUp` / `servicesFailed` lists + smoke results table

- [ ] Implement + register + commit (`feat(atlas-web): IacTopologyRenderer + DeployStatusRenderer`)

---

### Task 10: E2E test

**Files:**
- Create: `apps/atlas-web/e2e/tests/workflow-end-to-end-with-deploy.spec.ts`

Flow:
1. Cold-start prompt: "Build a todo SaaS with FastAPI backend, Next.js frontend, Postgres database, Keycloak auth, and bring it all up with docker compose"
2. Planner emits 4-node DAG: backend → frontend → iac → deploy
3. Approve + execute
4. All four nodes complete
5. DeployStatusRenderer shows all services up + smoke tests passing

This will use real LLMs and a real e2b sandbox — gated by `ATLAS_E2E_REAL_LLM=true`. Cost: ~$0.50–$2 per run; skip from default CI.

- [ ] Implement + commit

---

## Plan F — Self-review checklist
- [ ] Spec section 4 (Iac + Deploy schemas) → Task 1
- [ ] Spec section 10 (`iac` row: compose-only v1, topology, envContract) → Tasks 4, 5
- [ ] Spec section 10 (`deploy` row: compose-only v1, smoke tests) → Task 7
- [ ] Section 10 (per-node renderers for iac + deploy) → Task 9
- [ ] Section 1 OUT-of-scope items (Terraform, cloud targets, k8s) → respected; v1 = compose only

**Shippable result:** Workflows can now go from prompt to a docker-compose stack that's actually running with smoke tests passing. The first "build me a SaaS" → "open localhost:3000 and it works" path closes.
