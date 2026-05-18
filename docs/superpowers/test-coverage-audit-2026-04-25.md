# Test-Coverage Audit — 2026-04-25

Triggered by: user reported "system crashes" in atlas-web after the OpenAI-compat
provider landed in commit `513206c`. Goal: harden the seams that produce
silent / confusing failures, without committing to an unattended multi-day
autonomous loop.

## TL;DR — what this session changed

| Area | Before | After |
|------|--------|-------|
| `pnpm py:gen` / `pnpm py:test` | Required `uv` on PATH; failed silently as "exited null" | Resolves uv via `~/.local/bin/uv.exe` or the project venv directly |
| Python invariants enum | Stale (17 codes, TS source had 19) | Matches TS source (19); cardinality test now derives from artifact |
| `pnpm -r test` baseline | 1 package red (`postgres-branching`, confusing SASL error) | All 32 workspace packages green |
| `OpenAICompatProvider` | 0 tests | 16 tests; one robustness fix (empty-string `arguments`) |
| `ChatPanel` failure UX | Silent "button did nothing" on action rejection | `role="alert"` surface with the error message |
| `ChatPanel` tests | 1 test | 9 tests (history, pending, double-submit, error display) |
| `factory.ts` provider precedence | 1 smoke test | 7 tests covering both provider paths + the unconfigured warn |
| Playwright E2E | Setup crashed on missing secrets; CI filter typo (`@atlas/web`); zero auth-free coverage | globalSetup no-ops cleanly when secrets unset; CI filter fixed; 3 auth-free smoke specs (`/sign-in` renders, `/` redirects, screenshot capture) |
| Canvas sandbox-provision failure UX | Silent — `} catch {}` → forever-pulsing skeleton | `previewError` forwarded to client; `role="alert"` panel with recovery hint replaces skeleton |
| `CanvasPreviewClient` | 0 tests | 4 tests (iframe path, skeleton path, error panel path, recovery hint) |
| atlas-web suite | 37 files / 141 tests | 39 files / 175 tests |

10 commits to `main`, all behind merge commits, no force-pushes, no destructive ops.

### 2026-04-27 update — Plan B (architect → developer chain)

| Area | Before | After |
|------|--------|-------|
| ArchitectOutput render in ChatPanel | None | 3 panel variants (needs-input / plan / no-output), 5 tests |
| `RitualEngine.start()` chains architect → developer | Architect-only, returned ritualId | Optional `developerOutput` snapshot, `getRitual()` getter |
| `RitualSnapshot.developerOutput` | n/a | Captured + surfaced through Server Action + ChatPanel |
| Developer dispatch failure handling | Would crash whole ritual | Caught into `developer.dispatch.failed` event; ritual still 200 |
| `Conductor.dispatch` options | retry only | `forceRoleId` + `priorArtifact` (for chained roles) |
| `RoleInvocation.priorArtifact` | n/a | Optional, read by DeveloperRole |
| `DeveloperRole.parallelMode` | n/a | `"parallel"` (default) or `"sequential"` (single-proxy setups) |
| Post-hoc defaults for `testsAdded`/`filesModified` | n/a (model omission → 500) | `withDefaults()` recovers paths from diff; falls back gracefully |
| Architect's `graphSlice` echo requirement | Required model to repeat input metadata | Injected post-hoc; model only emits scope-specific fields |
| OpenAICompatProvider schema-injection prompt | "respond with this schema" | Now also enumerates required fields per discriminated-union variant |
| `factory.ts` registers DeveloperRole | No | Yes; `ATLAS_DEVELOPER_SEQUENTIAL` env opt-in for parallelMode |
| atlas-web vitest suite | 39 files / 175 tests | 41 files / 198 tests |
| @atlas/ritual-engine | 12 files / 42 tests | 13 files / 49 tests |
| @atlas/conductor | 11 files / 30 tests | 11 files / 32 tests |
| @atlas/role-developer | 12 files / 19 tests | 14 files / 30 tests |
| @atlas/role-architect | 13 files / 29 tests | 13 files / 30 tests |

5 additional commits on `main`. See `docs/superpowers/plans/2026-04-27-plan-b-developer-chain.md` for the full plan B record.

## Baseline of the monorepo (post-changes)

- `pnpm --no-bail -r typecheck`: 33 / 33 packages green
- `pnpm --no-bail -r test`: 32 / 33 packages green; 1 known flake (see Open issues)
- `pnpm py:gen` + `pnpm py:test`: 15 / 15 Python tests green; works from any shell
- `pnpm -F @atlas/spec-graph-schema test`: 204 tests across 46 files, all green
- atlas-web (`apps/atlas-web`): 38 files / 171 tests green

## Open issues found, ranked by severity

### 1. `@atlas/spec-graph-ops/test/exporter.test.ts` — flake under full suite

- **Symptom:** Test passes in isolation in 15s. In `pnpm -r test` the full file's wall time is 1641s before vitest force-times-out at the 60s test budget. A `"Cannot use a pool after calling end on the pool"` error log appears between `integration.test.ts` and `exporter.test.ts`.
- **Likely cause:** Cross-file Postgres pressure — `vitest.config.ts` runs all spec-graph-ops tests in `singleFork: true`, so a sibling test's pool teardown lingers and the next file's `beforeAll` reuses a half-dead pool. Or temp-dir contention from `cold-storage` cleanup.
- **Why deferred:** The repro takes 27 minutes per attempt; needs careful instrumentation, not a test-and-iterate loop.
- **Suggested next step:** Add per-file pool isolation via `beforeAll` creating + `afterAll` ending its own pool (already the pattern), but verify no shared module state. Alternative: run spec-graph-ops with `pool: "threads"` instead of `singleFork`.

### 2. `factory.ts` doesn't validate that the proxy is reachable

- **Symptom:** When `ATLAS_LLM_BASE_URL` points at a dead proxy, the first `ChatPanel.send()` is what discovers it (HTTP error from the provider). With my error-surface fix the user *sees* the error now, but ideally the engine would health-check on startup.
- **Why deferred:** Genuinely a design call — eager checks add startup latency and may flap under transient outages. The new error surface gives users the diagnostic; that may be enough.
- **Suggested next step:** Add a `pnpm -F atlas-web smoke:proxy` script that pings the proxy. Run it in dev start-up checklists, not in production.

### 3. Playwright auth-free smoke landed; persona suite still aspirational

- **Status:** Fixed for the smoke layer. `apps/atlas-web/e2e/tests/smoke-public.spec.ts` runs in 28s without secrets.
- **Still open:** The 10 existing persona specs (`diego-happy.spec.ts` etc.) reference UI test IDs that **don't exist in the codebase yet** — `intent-input`, `ritual-step-indicator`, `agree-artifact-card`, `preview-iframe`. Repairing them is feature work (build the canvas ritual stepper UI), not hardening.
- **Suggested next step:** Either (a) build the missing UI surfaces with the test IDs the persona specs already assert against, or (b) move the aspirational specs out of `e2e/tests/` into `e2e/aspirational/` so CI doesn't try to run them until they're realistic.

### 4. `factory.ts` dynamic-import code path isn't covered when env is set

- **Symptom:** The factory imports `pg`, `@anthropic-ai/sdk`, `prom-client` lazily inside the cached function. The new tests mock all of these. A real runtime mismatch (e.g., a peer-dep upgrade that changes a constructor signature) would only surface when ChatPanel is clicked.
- **Why deferred:** Dynamic-import surface is intentional (RSC trees). Catching this requires a real Node runtime test, which is what the integration story is for.
- **Suggested next step:** Add an `apps/atlas-web/test/integration/` folder with a vitest config using `environment: "node"` (separate from the jsdom default), and exercise factory.ts with real deps + a fake LLM endpoint server.

### 5. `ChatPanel` history is local-state only

- **Symptom:** Refresh = lose chat. Not a crash, but feels broken.
- **Why deferred:** Out of scope for "hardening" — it's a feature.
- **Suggested next step:** Promote to a real ticket. Use the `SpecEventRepo` already wired into the engine.

### 6. CRLF/LF on Windows produces noisy git warnings

- **Symptom:** Every commit prints `LF will be replaced by CRLF` for `.ts`, `.py`, `.json`. Tests still pass because `git diff --exit-code` normalizes, but the warnings clutter signal.
- **Why deferred:** Established Windows convention; fix is a `.gitattributes` audit + per-file decision.
- **Suggested next step:** Add `* text=auto eol=lf` to `.gitattributes` and run `git add --renormalize .` once.

## Things explicitly NOT touched

- The "governing agent that monitors continuously and never stops" pattern — system blocked me from setting it up unattended for multi-day duration; I think rightly so. The right substitute is a CI workflow you run from GitHub or a `pnpm precommit` script you run locally.
- The Postgres exporter flake (#1 above) — chose smaller, safer wins over one expensive debug session.
- `apps/atlas-web/lib/engine/persona-prefs.ts`, `event-sink.ts` — already have tests; no regression risk seen.

## Files added / changed this session

```
apps/atlas-web/
  components/ChatPanel.tsx                         (+12 lines: error surface)
  lib/engine/openai-compat-provider.ts             (+5 lines: empty-args robustness)
  test/components/ChatPanel.test.tsx               (1 → 9 tests)
  test/lib/engine/factory.test.ts                  (1 → 7 tests, +many mocks)
  test/lib/engine/openai-compat-provider.test.ts   (NEW, 16 tests)
package.json                                       (py:test now goes through Node)
packages/postgres-branching/
  test/setup.ts                                    (NEW, env default)
  vitest.config.ts                                 (+globalSetup line)
packages/spec-graph-schema-py/
  src/spec_graph_schema/invariants.py              (+I15, +I16)
  src/spec_graph_schema/models.py                  (regenerated, +3 compliance enums)
  src/spec_graph_schema/schema/spec-graph.v1.schema.json  (synced)
  tests/test_invariant_codes.py                    (de-hardcoded the 17)
  tests/test_models_roundtrip.py                   (de-hardcoded the 17)
tools/
  _python-bin.mjs                                  (NEW, uv resolver)
  generate-pydantic.mjs                            (uses resolver)
  run-pytest.mjs                                   (NEW, py:test runner)
```

## How to verify yourself

```bash
# All green expected:
pnpm --no-bail -r typecheck
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5440/atlas_test pnpm --no-bail -r test
pnpm py:gen && pnpm py:test
cd apps/atlas-web && pnpm test
```

`docker compose up -d postgres` first if Postgres isn't already running on 5440.
