# Multi-Stack E2B Template Expansion (Plan T) — Design

**Date:** 2026-05-07
**Status:** Awaiting user review (then writing-plans)
**Plans this spec produces:** Plan T v1 (atlas-fastapi + routing wiring), Plan T v2 (additional templates as separate sub-plans)
**Related:** PRD §22 (Phase B-2 cloud_migration fusion), Plan S spec, ADR-001 (OSS pivot)

---

## Problem

Plan S v1 shipped polish for **frontend** projects (sandbox uplift with shadcn/Tailwind/lucide; canvas + Designer + Researcher). But the architect's classifier already speaks 6 artifact kinds (`packages/canvas-runtime/src/types.ts`):

```ts
ArtifactKindSchema = z.enum([
  "frontend-app",
  "backend-rest-api",
  "backend-graphql",
  "data-pipeline",
  "mobile-app",
  "cli-tool"
]);
```

The Researcher catalog has dedicated reference YAMLs for `multi-tenant-saas-api`, `data-pipeline-etl`, `mobile-app-marketing`, etc. The Designer can produce `DesignTokens` for any category. The Schema canvas (Plan S.4) renders backend-tenancy choices for diego/priya personas.

**But the Developer role still writes every diff into a Next.js sandbox.** The `SANDBOX_CONTEXT_PROMPT` hardcodes "Your diff will be applied to a live Next.js 15 + Tailwind 3 + shadcn/ui project" — making the prompt a lie for any non-frontend artifact. Concrete failure modes:

- *"Build me a Python REST API for managing inventory"* → architect classifies as `backend-rest-api`, developer writes `app/api/*` Next.js Route Handlers (sub-optimal for Python users) OR tries to write FastAPI code into a Next.js sandbox (`Module not found: fastapi`).
- *"Build me a mobile app for tracking habits"* → no Expo/React Native sandbox exists; developer falls back to a web app, doesn't match user intent.
- *"Build me a CLI for batch-renaming photos"* → no Node-CLI sandbox; developer writes a web form.
- *"Build me a daily ETL job that loads CSV → DuckDB"* → no Python data-stack sandbox; developer writes a Next.js API route.

The B-4 commit (April 21) wired *structural* support for multiple templates (the sandbox factory accepts a `templateName` parameter), but no additional template directories were ever populated. So today, every project provisions Next.js regardless of architect classification.

## Goals

1. **One template per major artifact kind.** v1 ships `atlas-fastapi` to validate the routing wiring with a Python backend; v2 sub-plans add Hono/Bun, GraphQL, Expo, Python data-pipeline, Bun CLI.
2. **Architect → template routing.** The architect's `canvasManifest.artifactKind` decides which template the sandbox factory provisions. Per-project override via env stays available.
3. **Per-template developer prompt.** The `SANDBOX_CONTEXT_PROMPT` becomes a per-template registry. Each template ships its own positive-list prompt fragment describing what's installed, where to write files, what NOT to import.
4. **Per-template Researcher skill.** Researcher composes a per-artifact-kind skill so cited references match the category (FastAPI docs / Stripe API patterns for backends, not landing-page references).
5. **Per-template smoke-test page.** Each template's "ritual not started" page is appropriate to the stack (FastAPI returns `{"status":"ok"}`; CLI prints version).
6. **OSS-stack alignment.** Every template uses OSS deps only (matches ADR-001 — no SaaS-first defaults).
7. **Behavioural lock.** Flag-OFF (`ATLAS_FF_MULTI_STACK=false`) preserves today's exact pipeline: every project provisions `atlas-next-ts-v2` regardless of architect classification. Same engine, same prompts, same output.

## Non-Goals (v1)

- Building all 6 templates in one PR. v1 = `atlas-fastapi` + the routing primitive only. v2 sub-plans add the rest.
- Cross-template projects (e.g., a frontend-app project that also has a Python backend). v1 = one template per project. v2-v3 work.
- Migrating existing projects from `atlas-next-ts-v2` to other templates. Existing projects keep their pinned template.
- Building the Plan B-2 cloud_migration monorepo fusion — that's a separate strategic plan; T v1 just makes its eventual integration easier by establishing the FastAPI template + routing.
- Per-language Visual-Quality gate critique. v1 only screenshots web previews (FastAPI doesn't render a UI; gate auto-skips for non-frontend).

## Architecture

### Per-template prompt registry

```
packages/role-developer/src/
  sandbox-context-registry.ts                # NEW: maps templateName → prompt fragment
  sandbox-context-prompts/
    next-ts-v2.ts                            # MOVED: existing positive-list prompt
    fastapi.ts                               # NEW: Python+FastAPI positive-list prompt
    (later) hono-bun.ts, expo-rn.ts, ...
```

`assemble-prompt.ts` is updated to look up the prompt fragment by `targetTemplate` (passed in via `RoleInvocation` extension). Default = `next-ts-v2` if not specified.

### Architect → template routing

The architect's `canvasManifest.artifactKind` is the source of truth. Sandbox factory adds:

```ts
function templateForArtifactKind(kind: ArtifactKind, opts: { multiStackFlagOn: boolean }): string {
  if (!opts.multiStackFlagOn) return process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE ?? "atlas-next-ts-v2";
  switch (kind) {
    case "frontend-app":     return "atlas-next-ts-v2";
    case "backend-rest-api": return "atlas-fastapi";  // v1 ships only this; others fall through
    case "backend-graphql":  return "atlas-next-ts-v2";  // v2 will add atlas-graphql-yoga
    case "data-pipeline":    return "atlas-next-ts-v2";  // v2 will add atlas-dlt-python
    case "mobile-app":       return "atlas-next-ts-v2";  // v2 will add atlas-expo-rn
    case "cli-tool":         return "atlas-next-ts-v2";  // v2 will add atlas-bun-cli
  }
}
```

Per-project override via `ATLAS_DEFAULT_SANDBOX_TEMPLATE` env stays available for opt-out.

### atlas-fastapi template

```
packages/sandbox-e2b/templates/atlas-fastapi/
  e2b.toml                                   # template_name = "atlas-fastapi"
  Dockerfile                                 # python:3.12-slim + uv + (deps)
  pyproject.toml                             # FastAPI + Pydantic v2 + uvicorn + httpx + sqlalchemy + pytest + ruff
  uv.lock                                    # generated by uv lock
  app/
    main.py                                  # FastAPI() with /health endpoint (smoke test)
    __init__.py
  tests/
    test_main.py                             # pytest sanity test for /health
  README.md
  scripts/
    build-template.sh                        # mirrors atlas-next-ts pattern
    smoke-test-local.sh
```

**Pre-installed deps** (per the positive-list prompt fragment):

- `fastapi` 0.115+ (Python 3.12 compatible)
- `pydantic` 2.x + `pydantic-settings`
- `uvicorn[standard]` for the dev server
- `httpx` for client work
- `sqlalchemy` 2.x + `alembic` for ORM/migrations
- `psycopg2-binary` for Postgres
- `pytest` + `pytest-asyncio` for tests
- `ruff` for lint/format

### Per-template Researcher skills

```
packages/skill-library/skills/researcher/
  assemble-brief.md                          # existing — generic
  assemble-brief-frontend-app.md             # NEW: cites landing pages, dashboards
  assemble-brief-backend-rest-api.md         # NEW: cites Stripe/Twilio/FastAPI/Hono patterns
  cite-references.md                         # existing
```

ResearcherRole composes the per-artifact-kind skill when `designIntent.artifactKind` is set; falls back to generic `assemble-brief.md` otherwise.

### Smoke-test page per template

For atlas-fastapi:

```python
# app/main.py
from fastapi import FastAPI

app = FastAPI(title="Atlas Sandbox", version="0.1.0")

@app.get("/health")
def health():
    return {"status": "ok", "stack": "fastapi", "atlas": "sandbox-ready"}
```

Visiting `http://localhost:3000/health` returns the JSON. Confirms sandbox image works end-to-end. (Architect's `start_cmd` for this template will be `cd /code && uvicorn app.main:app --host 0.0.0.0 --port 3000`.)

### Visual-Quality gate skip

The Plan S.5 Visual-Quality gate checks `canvasManifest.modes` for `blockingFor === "design"`. For backend artifacts, the architect's `synthesizeCanvasManifest` produces a manifest with `schema` mode (not `design`). Gate auto-skips with `visual_quality.skipped` event — no behavior change needed in S.5.

## Persona awareness

ama persona on a backend-rest-api project:
- Sees outcome-framed cards in Schema canvas (already from S.4: "🛡️ Each customer fully isolated" etc.)
- Sees the resulting FastAPI codebase rendered in Code view (no Preview iframe — gate skipped)
- Hits a real running service at `/health`, `/docs` (FastAPI auto-Swagger), etc.

diego/priya persona on the same project:
- Sees Schema canvas with SQL/RLS detail
- Sees Endpoints canvas (in v2; placeholder in v1)
- Sees Exerciser canvas (in v2; placeholder in v1)

## Sandbox factory changes

`apps/atlas-web/lib/sandbox/factory.ts` (already accepts `templateName` parameter from B-4):

1. Read `architect.artifact.canvasManifest.artifactKind` from ritual snapshot.
2. If `ATLAS_FF_MULTI_STACK=true`, call `templateForArtifactKind(kind, { multiStackFlagOn: true })`.
3. Pass result as `templateName` to existing factory.
4. Per-project `ATLAS_DEFAULT_SANDBOX_TEMPLATE` env still wins if set.

## Testing strategy

- **Unit tests** in `@atlas/role-developer` for the new prompt-fragment registry (lookup by name, default fallback, missing-template error).
- **Unit tests** in atlas-web for `templateForArtifactKind` routing.
- **Integration test** in `packages/ritual-engine` that runs an architect → sandbox-factory chain with `artifactKind: "backend-rest-api"` and asserts the template name resolves to `atlas-fastapi`.
- **Smoke test** for the `atlas-fastapi` template via `scripts/smoke-test-local.sh` (Docker build + curl `/health`).
- **No new visual regression** in v1 — Visual-Quality gate auto-skips for backend.

## Feature flag rollout

Single new flag: **`ATLAS_FF_MULTI_STACK=false`** (default OFF). When OFF, every project provisions `atlas-next-ts-v2` (current main behavior). When ON, architect's `artifactKind` decides.

Sub-flags for v2 templates land per-template-PR (e.g., `ATLAS_FF_TEMPLATE_HONO_BUN=true`).

## Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| `artifactKind` is undefined (architect skipped that field) | factory check | Falls back to `atlas-next-ts-v2` (safe default) |
| `artifactKind === "mobile-app"` but no Expo template in v1 | factory check | Falls back to `atlas-next-ts-v2` + emits `sandbox.template.fallback` event so UI can warn |
| `atlas-fastapi` template not yet republished to E2B | E2B 404 on Sandbox.create | atlas-web Canvas shows red "Preview unavailable: template `atlas-fastapi` not found in your E2B account; operator must republish" |
| Developer's diff imports a Python lib not in the template (e.g., `pandas`) | sandbox.apply succeeds; runtime ImportError | User sees server error; auto-fix loop (Plan L) tries to patch out the bad import |

## Operator post-merge step

Same as Plan S.1: after Plan T v1 PR merges, an operator with `E2B_API_KEY` runs:

```bash
cd packages/sandbox-e2b/templates/atlas-fastapi
./scripts/build-template.sh
```

Captures new template ID; updates `e2b.toml` with the ID; commits.

## v1 / v2 cut

**v1 (this plan):**
- `atlas-fastapi` template (Python 3.12 + FastAPI + Pydantic + uvicorn + sqlalchemy + pytest + ruff)
- Per-template prompt fragment registry
- `templateForArtifactKind` routing function
- atlas-web factory uses the routing when `ATLAS_FF_MULTI_STACK=true`
- Per-template Researcher skill (`assemble-brief-backend-rest-api.md`)
- Tests + behind `ATLAS_FF_MULTI_STACK` flag
- Default OFF in code

**v2 (separate plans, one per template):**
- T.2.1 — `atlas-hono-bun` (Bun + Hono + Drizzle ORM)
- T.2.2 — `atlas-graphql-yoga` (Bun + GraphQL Yoga + Pothos)
- T.2.3 — `atlas-expo-rn` (Expo SDK 52 + React Native + NativeWind + Expo Router)
- T.2.4 — `atlas-dlt-python` (Python + dlt + DuckDB + dbt)
- T.2.5 — `atlas-bun-cli` (Bun + Commander + ink)

Each adds: 1 template directory, 1 prompt fragment, 1 Researcher skill, 1 routing case, 1 smoke test. Mechanical follow-up.

**v3 (further out):**
- Cross-stack projects (frontend-app + backend-rest-api in one project tree)
- Per-language Visual-Quality gate critique (e.g., FastAPI Swagger UI rendering quality)
- B-2 cloud_migration monorepo fusion building on the FastAPI template

## Open questions

1. **Should `atlas-fastapi` ship `uv` or `pip`?** Recommendation: `uv` (faster, increasingly standard, the existing `pnpm py:gen` already uses it).
2. **Should the smoke-test page expose `/docs` (FastAPI Swagger UI)?** Yes — it's a free demo and matches the "show me the API" diego/priya expectation.
3. **Should the routing function emit a metric per fallback?** Yes — counter `atlas_sandbox_template_fallback_total{from_kind, to_template}` so we can see which artifact kinds need their templates built.

## Sources

- Existing template pattern: `packages/sandbox-e2b/templates/atlas-next-ts/` (post-S.1)
- Existing factory plumbing: `apps/atlas-web/lib/sandbox/factory.ts` (post-B-4)
- Existing prompt: `packages/role-developer/src/assemble-prompt.ts` (post-S.1)
- Existing Researcher: `packages/role-researcher/` (post-S.2)
- Existing canvasManifest schema: `packages/canvas-runtime/src/types.ts` (post-S.4)
- ADR-001: `docs/adr/2026-04-21-oss-stack-pivot.md`
- E2B docs: https://e2b.dev/docs
- FastAPI docs: https://fastapi.tiangolo.com
- uv docs: https://docs.astral.sh/uv
