# Plan D.3 — Multi-backend cross-stack (3 TDD tasks)

**Spec:** `docs/superpowers/specs/2026-06-02-plan-d3-multi-backend-cross-stack-design.md`

## Tasks

### Task 1 — `generateApiClient` accepts an optional `fileName`

Extend the signature: `generateApiClient(openApiSpec, opts?: { fileName?: string })`.
When `fileName` is omitted, default to `"api-client.ts"` (so callers get the
existing `lib/api-client.ts` path). The function continues to return
`{ path, contents }` with `path` = `lib/${fileName}`.

- Add a unit test: passing `fileName: "api-client-backend-x.ts"` returns
  `path === "lib/api-client-backend-x.ts"`.
- Existing tests (no opts) keep passing.

### Task 2 — Engine emits N files for N backend upstreams

In `makeLaunchRitual` cross-stack block, replace the
`if (backendUpstreams.length > 1) throw` branch:

- Build `generatedFiles` as a loop over ALL `[backendNodeId, artifact]` pairs
  (preserving `node.consumes` order).
- For N == 1: keep calling `generateApiClient(spec)` (no opts) → `lib/api-client.ts`.
- For N >= 2: call `generateApiClient(spec, { fileName: \`api-client-${backendNodeId}.ts\` })`
  for each backend.

Tests (in `engine-launch-ritual-cross-stack.test.ts`):
- KEEP: single-backend → `generatedFiles[0].path === "lib/api-client.ts"`.
- KEEP: zero-backend → `generatedFiles` undefined.
- REPLACE the "throws on 2+" test with:
  - Two backend upstreams → `generatedFiles.length === 2`, paths are
    `lib/api-client-backend-a.ts` and `lib/api-client-backend-b.ts`, each
    contents matches `/export\s+interface\s+paths/`.
  - Three backend upstreams → `generatedFiles.length === 3`.

### Task 3 — Typecheck + run all workflow-engine tests

`pnpm --filter @atlas/workflow-engine typecheck` and
`pnpm --filter @atlas/workflow-engine test` both green.
