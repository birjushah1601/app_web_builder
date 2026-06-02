# Plan F.4 — Deploy production gaps (per-run Postgres branching + image build/push)

**Status:** Approved 2026-06-02
**Parent spec:** `docs/superpowers/specs/2026-06-02-plan-f3-deploy-persistence-smoke-design.md`
**Predecessors:** Plans A–G + D.2 + F + F.2 + F.3 merged. `DeployOrchestrator.deployFromArtifacts` runs the deploy, smoke tests, persists results, and rolls back cleanly. `branching` and `migrate` are stubs in `apps/atlas-web/lib/engine/factory.ts:buildDeployRunner` (`{schemaName: "main", created: false}` + applied=0).
**Successor (planned):** Plan F.5 — GitOps repo push, OpenStack-specific resources

---

## Goal

Close the two remaining production gaps where Plan F.2's intentional stubs are still in place:

1. **Real per-run Postgres branching.** Replace the inline stub in atlas-web's `buildDeployRunner` with a real implementation that wraps the existing `PgBranchingAdapter` (`@atlas/postgres-branching`) for `ensureBranch`/`dropBranch`/`listBranches` AND a real `migrate` callback that calls `replayMigrationsToSchema` against the spec-graph-data drizzle migrations directory.
2. **Image build + push.** New `packages/deploy-orchestrator/src/image-builder.ts` exporting `buildAndPushImages(images, opts)`. Takes the typed `DeployArtifact.imageBuilds[]` plus an injectable command runner (default `child_process.spawn`) and returns per-image results. Wired into `runDeployFromArtifacts` BEFORE applying manifests; on any image-build failure → throw immediately (no rollback necessary since nothing has been applied yet).

## Architecture decisions (locked)

1. **Branching stays in atlas-web's factory.** The orchestrator package keeps its `BranchingPort`/`MigratePort` contracts (no orchestrator-side knowledge of Postgres internals). The factory swaps the stub objects for adapter-backed ones. `@atlas/postgres-branching` is already a workspace dep of `@atlas/deploy-orchestrator` so we re-import it from atlas-web via the existing dependency tree.
2. **Branch naming:** delegate to `branchSchemaName(projectId, branchId)` (returns `br_<16-hex>`). Spec calls for `branch_<workflowRunId>` but the existing collision-safe hashed form is the canonical implementation in this repo (matches what `PgBranchingAdapter` already returns) and the orchestrator only consumes the returned `schemaName` opaquely. The functional outcome — one isolated schema per deploy — is identical.
3. **`migrate` calls `replayMigrationsToSchema`** with `migrationsDir = packages/spec-graph-data/drizzle` (resolved from `process.cwd()` since atlas-web boots from the monorepo root). The directory is read at call time; new migrations land automatically.
4. **DATABASE_URL_DEPLOY env var.** Reuses `DATABASE_URL` when unset; lets operators point per-run branches at a separate cluster from spec-graph-data's primary if needed. Validated alongside other deploy env vars in `buildDeployRunner` (only required when `ATLAS_FF_DEPLOY_RUNTIME=true`).
5. **Image builder uses `docker` CLI by default.** The injectable command runner shells out to `docker build` + `docker push`. Tests inject a fake runner to assert command shape without invoking docker. Cleaner than reaching for the Docker daemon HTTP API directly; the operator's image-registry auth is whatever `docker login` already configured.
6. **Image build failure is fail-fast, NOT rollback.** Builds run BEFORE any kubernetes-client/cloudflare-client call, so there's nothing to tear down. Throwing a clean `ImageBuildError` (extends `DeployError`) is enough.
7. **Per-image result shape:** `{serviceName, imageTag, digest?, ok, error?}`. `digest` is populated on success when `docker push` emits the digest line (parsed from stdout); absent when the runner returns no digest. `error` carries the stderr excerpt on failure.
8. **Parallel build is out of scope.** Sequential v1 is simpler to reason about; parallelisation is a polish task once we have a real registry in CI.

## `buildAndPushImages` shape

```ts
export interface ImageBuilderResult {
  serviceName: string;
  imageTag: string;
  digest?: string;
  ok: boolean;
  error?: string;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface BuildAndPushImagesOptions {
  runner?: CommandRunner;           // default: child_process.spawn wrapper
  cwd?: string;                     // build context root; default = process.cwd()
  perBuildTimeoutMs?: number;       // default 600_000 (10min per image)
  skipPush?: boolean;               // true → docker build only (useful for local + tests)
}

export async function buildAndPushImages(
  images: DeployArtifact["imageBuilds"],
  opts?: BuildAndPushImagesOptions
): Promise<ImageBuilderResult[]>;
```

Sequence per image:
- `docker build -t <imageTag> -f <dockerfilePath> <cwd>`
- if `!skipPush`: `docker push <imageTag>`
- on push: parse `digest: sha256:<hex>` from stdout (docker's standard format); attach to result.

## Out of scope (Plan F.5+)

- GitOps repo push (Argo Application via Git PR)
- OpenStack-specific manifests (LB, Cinder)
- Parallel image builds
- Image vulnerability scanning
- Build-cache layer reuse beyond docker's default
- BuildKit/buildx (operators that need it set `DOCKER_BUILDKIT=1` in env; the runner inherits it)
- Per-image registry credential injection (relies on existing `docker login`)

## Affected packages + new files

**New files:**
- `packages/deploy-orchestrator/src/image-builder.ts` — `buildAndPushImages` + `CommandRunner` + types
- `packages/deploy-orchestrator/test/image-builder.test.ts` — unit tests with injected runner
- `packages/deploy-orchestrator/test/deploy-from-artifacts-image-build.test.ts` — integration: image-build failure → throw before any k8s call
- `apps/atlas-web/lib/engine/branching.ts` (or inline in factory.ts — TBD) — real `BranchingPort` + `MigratePort` adapters
- (optional) `apps/atlas-web/test/lib/engine/branching.test.ts` — adapter unit test if extracted to its own module

**Modified files:**
- `apps/atlas-web/lib/engine/factory.ts` — swap stub `branching` + `migrate` for real adapters; add `DATABASE_URL_DEPLOY` to env validation
- `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` — call `buildAndPushImages` before applying manifests; on failure throw before any k8s call
- `packages/deploy-orchestrator/src/index.ts` — export `buildAndPushImages` + types

## Shippable result

A workflow's deploy node, with `ATLAS_FF_DEPLOY_RUNTIME=true`, now:
1. Builds and pushes every per-service image declared on the `DeployArtifact` BEFORE any k8s manifest is applied. Image-build failure throws cleanly with the stderr excerpt; no infra side-effects.
2. Creates a per-run Postgres schema via `PgBranchingAdapter` (one schema per `workflowRunId`/branchId pair, hashed), runs the full spec-graph-data migration history into it via `replayMigrationsToSchema`, and threads the schema name into the Knative env contract (already wired downstream).

What still remains for F.5: pushing the generated k8s manifests to the GitOps repo (today they're applied directly), and OpenStack-specific resources (LoadBalancer / Cinder volumes).
