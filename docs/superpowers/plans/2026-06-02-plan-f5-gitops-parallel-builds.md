# Plan F.5 — GitOps repo push + parallel image builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two production gaps from Plan F.4 — make `buildAndPushImages` optionally concurrent (opt-in `parallelism`), and add a `pushArgoApplicationToRepo` helper that pushes the generated Argo Application yaml to a gitops repo (clone → write → commit → push) instead of direct kubectl-apply.

**Architecture:** Two independent threads (parallelism inside `image-builder.ts`, new `gitops-repo.ts` module) that compose at the existing `runDeployFromArtifacts` boundary. No changes to atlas-web, role packages, or workflow-engine cross-stack code.

**Tech Stack:** TypeScript pnpm monorepo, vitest, `child_process.spawn` for git shell-out (injectable `GitClient`).

**Spec reference:** `docs/superpowers/specs/2026-06-02-plan-f5-gitops-parallel-builds-design.md`

**Depends on:** Plans A–G + D.2 + F + F.2 + F.3 + F.4 merged. Branch off current `main`.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/deploy-orchestrator/src/gitops-repo.ts` | `pushArgoApplicationToRepo` + `GitClient` interface + `nodeGitClient` |
| `packages/deploy-orchestrator/test/gitops-repo.test.ts` | Unit tests with injected fake `GitClient` |
| `packages/deploy-orchestrator/test/image-builder-parallel.test.ts` | Concurrent-dispatch test for the new parallelism path |
| `packages/deploy-orchestrator/test/deploy-from-artifacts-gitops.test.ts` | Integration: `opts.gitops` routes the Application via the helper, not direct apply |

### Modified files
| File | Change |
|---|---|
| `packages/deploy-orchestrator/src/image-builder.ts` | Add `parallelism` opt; batched `Promise.all` when > 1; preserves input order |
| `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` | Accept `opts.gitops` + `opts.imageBuildParallelism`; route Argo Application via gitops when configured |
| `packages/deploy-orchestrator/src/index.ts` | Export `pushArgoApplicationToRepo`, `GitClient`, `nodeGitClient`, related types |

---

## Tasks

### Task 1: Parallel image builds (opt-in)

**Files:**
- Create: `packages/deploy-orchestrator/test/image-builder-parallel.test.ts`
- Modify: `packages/deploy-orchestrator/src/image-builder.ts`

- [ ] **Step 1: Failing test** that asserts concurrent dispatch when `parallelism > 1`. The test starts N builds, each of which awaits a manual gate; asserts the runner was invoked N times BEFORE any gate is released (i.e., dispatch is concurrent, not sequential).

- [ ] **Step 2:** Run, expect failure (current implementation is sequential — when parallelism=2, all 4 dispatches happen ONE AT A TIME, so the assertion fails).

- [ ] **Step 3: Implement** by adding the `parallelism?: number` field to `BuildAndPushImagesOptions` and slicing `images` into batches of size N when > 1. Each batch resolves via `Promise.all` over the existing per-image function. Default 1 (today's behavior) is unchanged.

- [ ] **Step 4:** Run + typecheck + commit.

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): opt-in parallel image builds (Plan F.5 Task 1)"
```

---

### Task 2: `pushArgoApplicationToRepo` helper — pure-ish, injectable git client

**Files:**
- Create: `packages/deploy-orchestrator/src/gitops-repo.ts`
- Create: `packages/deploy-orchestrator/test/gitops-repo.test.ts`

The helper:
1. `mkdtemp` a work dir under `opts.workdir ?? os.tmpdir()`.
2. `gitClient.clone(repoUrl, dir, { branch, depth: 1 })`.
3. Compute file path = `opts.appPath ?? join(argoApplication.path, argoApplication.name + ".yaml")` and write `argoApplication.content` there.
4. `gitClient.add(dir, relPath)` then `gitClient.commit(dir, "deploy: <deployId>")`. If `committed=false` (no changes), short-circuit with `headSha`.
5. `gitClient.push(dir, { branch })`.
6. Resolve `{ commitSha, repoUrl, path, committed }`.
7. On success: clean up the temp dir.

- [ ] **Step 1: Failing test** at `packages/deploy-orchestrator/test/gitops-repo.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { pushArgoApplicationToRepo, type GitClient } from "../src/gitops-repo.js";
import type { DeployArtifact } from "@atlas/workflow-engine";
```

Covering:
- happy path: clone, write yaml at the expected path, add, commit, push (asserts call order on the fake).
- commit message includes deployId.
- `committed=false` → result `.committed` reflects it; push is still attempted (or skipped, per design — design says short-circuit returns `commitSha`; we attempt push because the local push of an unchanged branch is a no-op).
- custom `appPath` overrides the default path computation.
- custom `branch` is threaded into `clone` and `push`.

- [ ] **Step 2:** Run, expect failure (file doesn't exist).

- [ ] **Step 3: Implement** `packages/deploy-orchestrator/src/gitops-repo.ts` with `pushArgoApplicationToRepo` + a default `nodeGitClient` (shells out to git). The default client is NOT unit-tested at the I/O level (would require a fixture repo) — only tested indirectly via end-to-end smoke. The pure helper logic IS unit-tested with the injected fake.

- [ ] **Step 4: Export** from `packages/deploy-orchestrator/src/index.ts`.

- [ ] **Step 5:** Run + typecheck + commit.

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): pushArgoApplicationToRepo gitops helper (Plan F.5 Task 2)"
```

---

### Task 3: Wire `gitops` into `runDeployFromArtifacts`

**Files:**
- Modify: `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`
- Create: `packages/deploy-orchestrator/test/deploy-from-artifacts-gitops.test.ts`

When `opts.gitops` is configured, route the Argo Application via the new helper instead of `kubernetes.apply`. The IaC k8s manifests still flow through `kubernetes.apply` (unchanged). When `opts.gitops` is unset, today's behavior is preserved bit-for-bit.

Also threads `opts.imageBuildParallelism` into the `buildAndPushImages` call.

- [ ] **Step 1: Failing test** at `packages/deploy-orchestrator/test/deploy-from-artifacts-gitops.test.ts`:
  - asserts `kubernetes.apply` is NOT called with kind=`Application` when `opts.gitops` is set
  - asserts the gitClient was invoked (`clone`, `commit`, `push`)
  - asserts the unchanged-gitops path: when `opts.gitops` is undefined, `kubernetes.apply` IS called with kind=`Application` (regression guard)
  - asserts the orchestrator threads `opts.imageBuildParallelism` into the builder by observing concurrent dispatch via injected runner

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** the branch in `deploy-from-artifacts.ts`. Add `gitops?` + `imageBuildParallelism?` to `DeployFromArtifactsOptions`. In the apply loop, after the IaC manifests, branch on `opts.gitops`:
  - if set: `await pushArgoApplicationToRepo(..., opts.gitops)`; record a synthetic applied entry under namespace `gitops`.
  - if unset: existing `kubernetes.apply(ARGO_NAMESPACE, "Application", ...)` flow.

- [ ] **Step 4:** Run + typecheck + commit.

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): route Argo Application via gitops repo when configured (Plan F.5 Task 3)"
```

---

## Plan F.5 — Self-review checklist

- [ ] Spec §"Parallel image builds" → Task 1
- [ ] Spec §"`pushArgoApplicationToRepo` shape" → Task 2
- [ ] Spec §"`runDeployFromArtifacts` wiring" → Task 3
- [ ] No changes outside `packages/deploy-orchestrator` and docs

**Shippable result:** Plan F.5 ships. The orchestrator can fan out 2-6 concurrent image builds (when configured), and can push the Argo Application to a gitops repo (when configured) instead of direct kubectl-apply. Default opts preserve Plan F.4's behavior. OpenStack-specific resources + image vuln scanning remain deferred to Plan F.6.
