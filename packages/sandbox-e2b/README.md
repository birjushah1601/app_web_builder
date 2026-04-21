# @atlas/sandbox-e2b

Server-side TypeScript wrapper around the [E2B SDK](https://e2b.dev) for Atlas's live-preview sandbox infrastructure. Exposes four typed interfaces so every consumer can inject a mock for tests. **Never imported by browser code.**

## Interfaces

| Interface | Implementation | Description |
|---|---|---|
| `SandboxLifecycle` | `E2BLifecycle` | Provision / terminate / restart sandboxes |
| `SandboxFileSystem` | `E2BFileSystem` | Read / write / list / watch remote files |
| `SandboxExec` | `E2BExec` | Run commands (batch) or stream stdout/stderr |
| `SandboxPreview` | `E2BPreview` | Get the HTTPS preview URL for a sandbox port |

## Quick start

```ts
import {
  E2BLifecycle, E2BFileSystem, E2BExec, E2BPreview,
  checkSpendCap,
} from "@atlas/sandbox-e2b";

const lifecycle = new E2BLifecycle({
  apiKey: process.env.E2B_API_KEY!,
  templateDigests: {
    "atlas-next-ts": process.env.E2B_TEMPLATE_NEXT_TS_DIGEST!,
    "atlas-python-fastapi": process.env.E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST!,
  },
});

// check cap before provisioning
await checkSpendCap(projectId, spendReader, { capUsd: 50, warnMultiplier: 3 });

const record = await lifecycle.provision("atlas-next-ts", projectId);
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `E2B_API_KEY` | Yes | E2B API key — server-side only, never sent to browser |
| `E2B_TEMPLATE_NEXT_TS_DIGEST` | Yes | Pinned digest for the `atlas-next-ts` template |
| `E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST` | Yes | Pinned digest for the `atlas-python-fastapi` template |
| `E2B_TEMPLATE_REACT_VITE_DIGEST` | B-4 | Pinned digest for the `atlas-react-vite` template (Phase B) |
| `E2B_TEMPLATE_ASTRO_DIGEST` | B-4 | Pinned digest for the `atlas-astro` template (Phase B) |
| `E2B_TEMPLATE_SVELTEKIT_DIGEST` | B-4 | Pinned digest for the `atlas-sveltekit` template (Phase B) |
| `E2B_TEMPLATE_EXPO_DIGEST` | B-4 | Pinned digest for the `atlas-expo` template (Phase B) |
| `SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH` | No | Per-project monthly spend cap in USD (default: 50) |

## Spend cap

`checkSpendCap(projectId, reader, config)` must be called before every `lifecycle.provision()`. It:
1. Reads accumulated spend from the current billing month via the injected `SpendReader`.
2. Throws `SpendCapExceededError` if accumulated ≥ `capUsd`.
3. Emits `console.warn` if accumulated ≥ `warnMultiplier × 30-day rolling average`.

The production `SpendReader` reads from `@atlas/spec-graph-data`'s `sandbox_spend_log` table. Tests inject an in-memory stub.

## Template versioning

Templates are pinned by digest in `apps/atlas-web/.env`. A weekly GitHub Actions workflow:
1. Rebuilds the Docker image from `apps/atlas-web/docker/atlas-next-ts.Dockerfile` (or `atlas-python-fastapi.Dockerfile`).
2. Pushes to E2B via `e2b template push`.
3. Opens a PR updating `E2B_TEMPLATE_NEXT_TS_DIGEST` (and/or fastapi variant).
4. Auto-merges if a smoke test against the new digest passes.

This mirrors the Plan C.2 release pattern.

## Testing

```bash
cd packages/sandbox-e2b
pnpm test
```

All tests mock `@e2b/sdk` — no real E2B provision in CI.
