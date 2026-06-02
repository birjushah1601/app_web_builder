# Plan F.2 — Deploy Runtime Execution (artifact-driven)

**Status:** Approved 2026-06-02
**Parent spec:** `docs/superpowers/specs/2026-05-29-plan-f-iac-deploy-design.md`
**Predecessors:** Plans A-G + D.2 merged. `@atlas/deploy-orchestrator` (C-1) exists with kubernetes-client, cloudflare-client, manifest emission, and Argo reconcile/rollback.
**Successor (planned):** Plan F.3 — smoke test HTTP execution, image build+push, Argo CD GitOps repo push

---

## Goal

When a workflow `deploy`-kind node completes its producer step (DeployerRole emits `DeployArtifact`) AND `ATLAS_FF_DEPLOY_RUNTIME=true`, the workflow engine hands the artifact to `DeployOrchestrator.deployFromArtifacts(...)`, which applies Plan F's LLM-generated K8s manifests + Argo CD `Application` + DNS via the existing kubernetes-client + cloudflare-client. On Argo health "Healthy", returns a `DeployResult` (publicUrl, Argo app name, etc.). The result is persisted onto the workflow node and surfaced in `DeployCanvas`. When the flag is off, today's Plan F behavior is preserved (artifact persisted, no runtime side effect).

## Architecture decisions (locked)

1. **Approach A — artifacts ARE the contract.** `deployFromArtifacts` consumes Plan F's `IacArtifact.k8s.manifests[]` + `DeployArtifact.argoApplication` verbatim. The existing `DeployOrchestrator.deploy(request)` (canonical-manifest-emission path) stays untouched for non-workflow callers (or is later retired).
2. **Same orchestrator class, new method.** Add `deployFromArtifacts(input)` to `DeployOrchestrator`. Reuses existing kubernetes-client + cloudflare-client + reconcile + rollback. Does NOT call `emitKnativeServiceManifest` / `emitArgoApplicationManifest` / `emitCertificateManifest`.
3. **Branch management stays.** `branching.ensureBranch` + `migrate` still run. Plan F.2 doesn't change DB branching semantics.
4. **DNS still via Cloudflare.** Per-deploy `subdomain` + `apex` come from the project metadata (same as `deploy()` today). The artifact doesn't carry FQDN — that's environment config.
5. **Namespace handling.** Default namespace for applied manifests = `"atlas-projects"` (matches `deploy()` today). If a manifest's YAML body declares a different `metadata.namespace`, the orchestrator passes that namespace to `kubernetes.apply` — i.e. we PARSE just enough YAML to extract namespace; everything else stays in the YAML body.
6. **Failure handling.** Same rollback as `deploy()`: on Argo not-healthy, delete every applied manifest + DNS, throw. Symmetric with `deploy()`.
7. **Workflow-engine wiring.** When `deploy`-kind ritual completes AND emitted a valid DeployArtifact AND flag is on, engine calls `deployFromArtifacts` AFTER the producer step (not as a role; as an engine-level post-producer hook). Result is stored on the node's `deployResult` field (new optional snapshot field). On failure, the node is marked `failed` with the error in `node.failure.error`.
8. **Flag default off.** `ATLAS_FF_DEPLOY_RUNTIME=false` by default. Operators enable per-environment.
9. **Image build/push and smoke tests are explicitly OUT.** Plan F.3 owns those. F.2 assumes images referenced in the artifact are already pushed to the registry; smoke tests are visible in DeployCanvas but not executed.
10. **One cluster, one Cloudflare.** Per-project cluster targeting is Plan F.3+. Plan F.2 reads kube config + cloudflare creds from env (same path as existing `deploy()`).

## Affected packages + new files

**New files:**
- `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` — the new method (kept in its own file so the existing `orchestrator.ts` stays focused on canonical-manifest deploys)
- `packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts` — tests via in-memory clients
- `packages/workflow-engine/test/integration-deploy-runtime.test.ts` — end-to-end (fake K8s/Cloudflare, real DeployArtifact)

**Modified files:**
- `packages/deploy-orchestrator/src/orchestrator.ts` — class gets the new method (delegates to deploy-from-artifacts.ts to keep file size sane)
- `packages/deploy-orchestrator/src/index.ts` — export the new types
- `packages/workflow-engine/src/engine.ts` — new post-producer deploy hook for `deploy`-kind nodes when flag is on
- `packages/workflow-engine/src/types.ts` — optional `deployResult?: { publicUrl, argoApplicationName, phase }` on WorkflowNode
- `apps/atlas-web/lib/engine/factory.ts` — construct DeployOrchestrator + inject into workflow engine
- `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` — when `node.deployResult` is set, show live deploy status instead of the F.2 banner

## `deployFromArtifacts` signature

```ts
export interface DeployFromArtifactsInput {
  projectId: string;
  branchId: string;
  subdomain: string;
  apex: string;
  iacArtifact: IacArtifact;        // for k8s.manifests
  deployArtifact: DeployArtifact;  // for argoApplication
  target?: DeployTarget;           // "preview" | "production", default "preview"
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
```

## Out of scope (Plan F.3 / later)

- Smoke test HTTP execution + result capture
- Image build + push (assumes pre-built)
- GitOps repo push (we apply Argo Application directly; `repoUrl` in artifact is a placeholder)
- Per-project cluster targeting (one cluster from env)
- OpenStack-specific resource generation (LB YAML, Cinder PVCs)
- Helm chart support
- Multi-cluster deploys
- Deploy approval gates (manual user click → "go live")
- Resume after rollback

## Shippable result

A user submits a prompt → workflow plans backend + iac + deploy. After deploy node's producer emits the artifact, the engine applies it: every K8s manifest + Argo Application gets `kubectl apply`d through the existing kubernetes-client; DNS is upserted via cloudflare-client; Argo reconciles to "Healthy"; the public URL appears on the deploy node in the canvas. If anything fails, the engine rolls back (same path as today's `deploy()`) and marks the node failed with the error. Plan F.3 plugs in smoke tests + image build behind the same `deployFromArtifacts` contract.
