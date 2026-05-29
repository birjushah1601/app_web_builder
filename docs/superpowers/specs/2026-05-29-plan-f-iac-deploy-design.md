# Plan F — IaC + Deploy Artifact Kinds (compose + K8s, no execution)

**Status:** Approved 2026-05-29
**Parent spec:** `docs/superpowers/specs/2026-05-26-multi-artifact-workflow-design.md` (§4, §10)
**Predecessors:** Plans A (engine), B (planner), C (graph UI), D (backend producer + typed-handoff foundation), E (tests producer)
**Successor (planned):** Plan F.2 — runtime execution (apply manifests via Argo CD, push images, run smoke tests)

---

## Goal

Two new artifact kinds — `iac` and `deploy` — that together describe how to deploy a workflow's runtime nodes to a Kubernetes cluster (target: K8s on OpenStack per the OSS-stack pivot) AND run them locally via docker-compose. Plan F v1 produces, validates, and persists the typed artifacts. **No runtime execution** — actually applying manifests, building/pushing images, and running smoke tests is Plan F.2.

This honors the "robust + feature-flagged from day one" principle: the production-shaped artifact contract is in place from v1; the runtime adapter slots in behind it.

## Architecture decisions (locked)

1. **Two artifact kinds in one plan.** They share a domain (containers, services) and deploy consumes iac. Splitting forces stub-of-stub renderers and a deferred handoff test.
2. **Producer-only scope.** No `kubectl apply`, no `argocd app sync`, no image push, no smoke HTTP exec. Artifacts contain the files + manifest references; Plan F.2 wires the runtime.
3. **iac produces BOTH compose AND k8s manifests.** Compose for local-run / sandbox preview; k8s for the production target. Both stored inline in the artifact (no external storage in v1).
4. **deploy targets K8s only.** Compose is the iac concern; deploy is "how does this go live on the cluster." The deploy artifact references the iac's k8s manifests + a generated Argo CD `Application` manifest + smoke-test definitions + a Dockerfile/image-build reference.
5. **OpenStack details are NOT in the artifact contract.** Cluster API endpoint, OIDC, load-balancer config, OpenStack CSI volumes — all deployment-time config that lives in the runtime adapter (Plan F.2). The artifact contract is portable across any K8s cluster.
6. **Role split = `role-iac` + `role-deployer`.** Two roles, two ritual chains via Plan E's `roleChain` hint. role-deployer's consumes includes the iac node.
7. **Renderers = IacCanvas + DeployCanvas.** Read-only. Replace Plan C's `IacStubCanvas` and `DeployStubCanvas`.
8. **Optional lint via `docker compose config`** if available inside the role's sandbox. Best-effort; falls back to no-op skip when docker isn't installed.

## Per-kind shapes

```ts
// iac
IacArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("iac"),
  // Local-run / preview target
  compose: z.object({
    file: z.string(),        // "docker-compose.yml"
    content: z.string()      // full YAML
  }),
  // Production K8s target
  k8s: z.object({
    manifests: z.array(z.object({
      file: z.string(),      // "k8s/api-service.yaml"
      kind: z.string(),      // "Service" | "Knative Service" | "Certificate" | "Namespace" | etc.
      name: z.string(),      // metadata.name
      content: z.string()    // full YAML
    }))
  }),
  // Abstract topology — services and their port + envContract
  services: z.array(z.object({
    name: z.string(),                       // "api", "web", "tests-reports"
    runtimeNodeId: z.string(),              // workflow node id (which produced this service)
    artifactKind: z.string(),               // upstream node's artifactKind
    port: z.number().int().positive().optional(),
    envContract: z.array(z.object({
      name: z.string(),
      required: z.boolean(),
      description: z.string().optional()
    }))
  })),
  // Image-registry pointer (placeholder by default; Plan F.2 wires real values)
  imageRegistry: z.object({
    url: z.string(),                        // "registry.atlas.local/projects" or similar
    namespace: z.string()                   // typically the project id
  })
})

// deploy
DeployArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("deploy"),
  target: z.literal("k8s"),                 // v1 = k8s only
  // Argo CD Application manifest that points at the iac k8s/ path
  argoApplication: z.object({
    file: z.string(),                       // "argo/application.yaml"
    content: z.string(),                    // full YAML
    name: z.string(),                       // metadata.name
    repoUrl: z.string(),                    // git repo URL placeholder
    path: z.string()                        // path inside the repo (e.g. "k8s/")
  }),
  // Per-service Dockerfile references — one per buildable service
  imageBuilds: z.array(z.object({
    serviceName: z.string(),                // matches IacArtifact.services[].name
    dockerfilePath: z.string(),             // path inside the sandbox
    imageTag: z.string()                    // "{registry}/{namespace}/{service}:{sha}"
  })),
  // Smoke tests — described, not executed in v1
  smokeTests: z.array(z.object({
    url: z.string(),                        // "/health" or "/api/v1/status"
    method: z.enum(["get", "post", "put", "patch", "delete", "head"]).optional(),
    expectStatus: z.number().int().min(100).max(599),
    expectBodyContains: z.string().optional()
  }))
})
```

## Out of scope (Plan F.2 / later)

- Actually applying manifests / `kubectl apply` / `argocd app sync`
- Image build + push to a registry (registry credentials, buildkit setup)
- Smoke-test HTTP execution + result capture (writes results back into the artifact)
- OpenStack-specific config (load balancer YAML, Cinder CSI volumes, Octavia)
- Helm charts (raw YAML is enough for v1)
- Terraform / Pulumi / Crossplane providers
- Cloud cost estimation
- Multi-cluster / multi-region routing
- GitOps repo bootstrap (the Argo CD `Application` references a repo URL, but actually pushing to that repo is Plan F.2)

## Affected packages + new files

**New packages:**
- `packages/role-iac/` — workspace skeleton, src, test
- `packages/role-deployer/` — workspace skeleton, src, test

**New files:**
- `packages/workflow-engine/src/artifact-contracts/iac.ts` — IacArtifactSchema + registration
- `packages/workflow-engine/src/artifact-contracts/deploy.ts` — DeployArtifactSchema + registration
- `packages/role-iac/src/{build-artifact,role}.ts` and tests
- `packages/role-deployer/src/{build-artifact,role}.ts` and tests
- `apps/atlas-web/components/canvas/renderers/IacCanvas.tsx` — replaces IacStubCanvas
- `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` — replaces DeployStubCanvas
- Test files for the components
- `packages/workflow-engine/test/integration-iac-deploy-handoff.test.ts` — 3-node DAG (backend → iac → deploy)

**Modified files:**
- `packages/workflow-engine/src/artifact-contracts/index.ts` — side-effect imports
- `packages/workflow-engine/src/index.ts` — type re-exports
- `packages/workflow-engine/src/engine.ts` — `makeLaunchRitual`: roleChain branch extended to dispatch `["iac"]` and `["deployer"]` for the new kinds
- `apps/atlas-web/lib/engine/factory.ts` — register IacRole + DeployerRole in the conductor's roles Map
- `apps/atlas-web/components/canvas/register-renderers.tsx` — swap both stubs for real renderers

**Deleted files:**
- `apps/atlas-web/components/canvas/renderers/IacStubCanvas.tsx`
- `apps/atlas-web/components/canvas/renderers/DeployStubCanvas.tsx`

## Shippable result

A workflow with iac + deploy nodes runs end-to-end (producer-only): IacRole reads upstream runtime artifacts (frontend, backend), LLM-generates docker-compose.yml + k8s manifests + service topology, optionally lints the compose file, emits the typed IacArtifact. DeployerRole consumes the iac artifact, LLM-generates the Argo CD `Application` + per-service Dockerfile references + smoke-test definitions, emits the typed DeployArtifact. The user drills into either node and sees the rendered files + topology (iac) or the deploy manifest list + smoke checks (deploy). Plan F.2 plugs in the runtime adapter behind the same artifact contract.
