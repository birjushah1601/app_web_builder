# Plan F.5 — GitOps repo push + parallel image builds

**Status:** Approved 2026-06-02
**Parent spec:** `docs/superpowers/specs/2026-06-02-plan-f4-deploy-production-gaps-design.md`
**Predecessors:** Plans A–G + D.2 + F + F.2 + F.3 + F.4 merged. `runDeployFromArtifacts` already builds + pushes images sequentially before any k8s call, and directly `kubectl apply`s the generated Argo Application.
**Successor (planned):** Plan F.6 — OpenStack-specific resources, image vulnerability scanning

---

## Goal

Close two remaining production gaps in the deploy pipeline:

1. **Parallel image builds.** Today's `buildAndPushImages` is sequential — fine for one or two services, bottleneck for the 4-6 services a typical artifact will declare. Add an opt-in `parallelism?: number` option that runs builds in batches via `Promise.all`. Default `1` preserves today's behavior exactly.

2. **GitOps repo push.** Today the orchestrator's `kubernetes.apply` of the Argo Application is a direct `kubectl apply` against the management cluster. Real GitOps means the source of truth is a Git repo, and Argo CD reconciles FROM that repo. Add a new `pushArgoApplicationToRepo(input, opts)` helper that clones a target repo via injectable `GitClient`, writes the Application yaml, commits with the deployId, and pushes. Wire it into `runDeployFromArtifacts` so that when `opts.gitops` is configured the orchestrator pushes to the repo INSTEAD of direct kubectl-apply. When `opts.gitops` is unset, today's direct-apply path is preserved unchanged.

## Architecture decisions (locked)

1. **Parallelism is opt-in, default = 1.** Today's deploy paths are all driven by `runDeployFromArtifacts(opts, input)` and `opts.imageRunner` is untouched in production. Adding a `parallelism` field on `BuildAndPushImagesOptions` (default `1`) means no callsite needs to change to keep current behavior. When `parallelism > 1` we slice `images` into batches of size N and `await Promise.all` each batch. Builds remain fail-soft per-image (each gets a result); failures don't short-circuit the batch.

2. **Order of results = order of input.** Even when parallelism > 1, the returned `ImageBuilderResult[]` must preserve the order the caller passed in. This is automatic with batched `Promise.all` (each batch returns ordered) and keeps the test/reporting story stable.

3. **GitOps lives in a new module.** `packages/deploy-orchestrator/src/gitops-repo.ts` exports `pushArgoApplicationToRepo` + a `GitClient` interface + a default `nodeGitClient` that wraps `node:child_process` git invocations (`clone`, `add`, `commit`, `push`). The orchestrator's existing `kubernetes-client.ts` is untouched — gitops is a sibling adapter, not a replacement.

4. **Clone target is a temp dir.** We use `node:fs/promises mkdtemp(os.tmpdir() + "/atlas-gitops-")` and clone shallow (`--depth 1`) for speed. The dir is removed via `fs.rm(..., {recursive: true, force: true})` after a successful push. On a thrown error we leave it (operators can inspect).

5. **`GitClient` is injectable.** Tests pass a fake `GitClient` whose `clone` writes nothing (or writes a stub repo to the dir) and whose `commit`/`push` are vi.fn assertions. The default `nodeGitClient` shells out to `git`. Same shape as `CommandRunner` in F.4.

6. **Path inside the repo.** The Argo Application's repo-relative path comes from `deployArtifact.argoApplication`. The spec adds an `appPath?` field on `pushArgoApplicationToRepo` opts that defaults to `deployArtifact.argoApplication.path` joined with the Application's filename. Today's Application yaml content is written verbatim into that file.

7. **Commit message = deployId.** `"deploy: {deployId}"` is the canonical message; idempotent retries from the same workflowRun get the same deployId (the orchestrator generates it once at entry). If the working tree has no changes after the write (re-deploy with no spec change), the helper short-circuits with `commitSha: <existing-head>`.

8. **GitOps replaces direct Application apply ONLY.** The IaC k8s manifests (Service, Deployment, etc.) keep going through `kubernetes.apply` because they are NOT what Argo CD is told to watch — Argo CD watches the repo. Long-term these should also live in the repo and be applied by Argo CD; the spec for that lives in F.6.

9. **Reconcile loop unchanged.** Even with GitOps push, the orchestrator still polls `kubernetes.argoApplicationHealth(name)` for the post-deploy health check. The Application must already be REGISTERED in the cluster (one-time, by the operator) — Argo CD watches the registered Application and reconciles its status from the repo. The reconcile timeout already accounts for git → Argo polling delay.

10. **No PR flow in v1.** We push directly to the default branch. PR-based gitops (Argo CD's RECOMMENDED long-term flow) is F.6 — it requires GitHub/GitLab API credentials we don't have a contract for yet. v1's "direct push to main" is the minimum-shippable thing.

## `buildAndPushImages` shape changes

```ts
export interface BuildAndPushImagesOptions {
  runner?: CommandRunner;
  cwd?: string;
  perBuildTimeoutMs?: number;
  skipPush?: boolean;
  /** Plan F.5 — when > 1, builds run in batches of N concurrently via
   *  Promise.all. Order of returned results matches order of input.
   *  Default 1 = today's sequential behavior. */
  parallelism?: number;
}
```

## `pushArgoApplicationToRepo` shape

```ts
export interface GitClient {
  clone(repoUrl: string, dir: string, opts?: { branch?: string; depth?: number }): Promise<void>;
  add(dir: string, pathRel: string): Promise<void>;
  commit(dir: string, message: string): Promise<{ sha: string; committed: boolean }>;
  push(dir: string, opts?: { branch?: string }): Promise<void>;
  /** Resolve current HEAD sha. Used when commit short-circuits (no changes). */
  headSha(dir: string): Promise<string>;
}

export interface PushArgoApplicationOptions {
  /** Required. URL of the gitops repo to clone (HTTPS or SSH). */
  repoUrl: string;
  /** Optional. Target branch (default "main"). */
  branch?: string;
  /** Optional. Override default git client. Default = nodeGitClient. */
  gitClient?: GitClient;
  /** Optional. Override path inside the repo. Default = deployArtifact.argoApplication.path/<name>.yaml */
  appPath?: string;
  /** Optional. Working directory root for clones (default os.tmpdir()). */
  workdir?: string;
}

export interface PushArgoApplicationInput {
  deployId: string;
  deployArtifact: DeployArtifact;
}

export interface PushArgoApplicationResult {
  commitSha: string;
  repoUrl: string;
  path: string;
  committed: boolean;
}

export async function pushArgoApplicationToRepo(
  input: PushArgoApplicationInput,
  opts: PushArgoApplicationOptions
): Promise<PushArgoApplicationResult>;
```

## `runDeployFromArtifacts` wiring

`DeployFromArtifactsOptions` gains an optional `gitops` field:

```ts
export interface DeployFromArtifactsOptions {
  // ... existing ...
  /** Plan F.5 — when set, the Argo Application is pushed to this repo
   *  INSTEAD of being applied directly to the cluster. Argo CD reconciles
   *  from the repo. When unset, today's direct-apply behavior is preserved. */
  gitops?: {
    repoUrl: string;
    branch?: string;
    gitClient?: GitClient;
    appPath?: string;
  };
  /** Plan F.5 — when > 1, image builds run with that many concurrent
   *  docker invocations. Default 1 = today's sequential. */
  imageBuildParallelism?: number;
}
```

The orchestrator path becomes:

```ts
// ... apply IaC k8s manifests (unchanged) ...

if (opts.gitops) {
  const pushed = await pushArgoApplicationToRepo(
    { deployId, deployArtifact: input.deployArtifact },
    opts.gitops
  );
  // For observability — surface on the result object.
  appliedManifests.push({ namespace: "gitops", kind: "Application", name: input.deployArtifact.argoApplication.name });
  // Argo CD will reconcile the Application from the repo; we still poll health below.
} else {
  await opts.kubernetes.apply(ARGO_NAMESPACE, "Application", ..., input.deployArtifact.argoApplication.content);
  appliedManifests.push({ namespace: ARGO_NAMESPACE, kind: "Application", name: ... });
}
```

## Out of scope (Plan F.6+)

- PR-based GitOps (open a PR rather than direct push to main)
- OpenStack-specific resources (LoadBalancer service, Cinder PVCs)
- Image vulnerability scanning (Trivy/Grype integration)
- Per-build resource limits (memory cap on docker build)
- Image registry credential injection beyond `docker login`
- Reading existing repo contents to compute diff/skip-if-no-change at the orchestrator level (the gitops helper has its own "no changes" short-circuit, but the orchestrator unconditionally invokes it)
- Multi-repo gitops (one Application per repo)
- BuildKit/buildx parallelism inside a single docker build (already controlled by DOCKER_BUILDKIT env)

## Affected packages + new files

**New files:**
- `packages/deploy-orchestrator/src/gitops-repo.ts` — `pushArgoApplicationToRepo` + `GitClient` + types + `nodeGitClient`
- `packages/deploy-orchestrator/test/gitops-repo.test.ts` — unit tests with injected fake `GitClient`
- `packages/deploy-orchestrator/test/image-builder-parallel.test.ts` — concurrent-dispatch test for the new parallelism path
- `packages/deploy-orchestrator/test/deploy-from-artifacts-gitops.test.ts` — integration: gitops opts route the Application via the helper instead of direct apply

**Modified files:**
- `packages/deploy-orchestrator/src/image-builder.ts` — add `parallelism` opt; batched `Promise.all` when > 1
- `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` — accept `opts.gitops` + `opts.imageBuildParallelism`; route Application via gitops when configured
- `packages/deploy-orchestrator/src/index.ts` — export `pushArgoApplicationToRepo`, `GitClient`, `nodeGitClient`, related types

## Shippable result

A workflow's deploy node, with `ATLAS_FF_DEPLOY_RUNTIME=true`:

1. **Parallel builds:** when `opts.imageBuildParallelism > 1`, the N declared images build + push concurrently. Wall-clock for a 4-service artifact drops from ~4×T to ~T+ε on machines with enough docker daemon throughput.
2. **GitOps push:** when `opts.gitops.repoUrl` is configured, the generated Argo Application yaml is written to that repo (default branch, `--depth 1` clone, commit-msg includes deployId) instead of being applied directly to the management cluster. Argo CD reconciles from the repo; the orchestrator's existing health poll waits for Healthy. When `opts.gitops` is unset, today's direct-apply path is preserved bit-for-bit.

What still remains for F.6: PR-based gitops, OpenStack-specific manifests, vulnerability scanning, multi-repo support.
