# SchemaCanvas + Schema-Architect Role — Design Spec

**Date:** 2026-05-21
**Status:** Approved for plan-writing
**Lifecycle pillar:** Visualize / Build
**Mission tie-in:** Closes the canvas-side crash for backend rituals; gives Atlas a production-grade DB schema design surface — "powerful + extensible + best-practices by construction" per the user's explicit ask.

## 1. Overview

Today's `defaultManifestForArtifactKind()` returns `{ renderer: "schema" }` for `backend-rest-api` and `backend-graphql` artifacts, but `canvasModeRegistry` only registers `designing`, `refining`, and `preview` — so backend rituals crash at the canvas. Meanwhile, the frontend lifecycle has a structured visualize-step (`role-designer` → `<DesignerCanvas>` → `selectDesignDirection`) that lets the user approve a design before the developer commits to code. Backend rituals have no equivalent.

This spec defines the symmetric backend artifact:
- A new `@atlas/role-schema-architect` package that emits 3 architectural directions for a backend ritual, each containing both an **API contract** and a **DB-grade data model**.
- A new `<SchemaCanvas>` renderer registered under `renderer: "schema"`, rendering the 3 directions with expand-on-select and a Contract | Data Model split-pane.
- A new `selectSchemaDirection` server action mirroring `selectDesignDirection`, resuming the ritual with the user's pick threaded into the developer's `priorArtifact`.
- Conditional dispatch in `apps/atlas-web/lib/engine/factory.ts` — backend rituals get schema-architect in the slot designer occupies for frontend rituals.

Single-pass v1 (Sonnet 4.5 one-shot emit). 3-pass (draft → critique → revise) scaffolded behind `ATLAS_FF_SCHEMA_ARCHITECT_3PASS` for v2.

## 2. Scope

### v1 ships

- `packages/role-schema-architect/` mirroring `role-designer/`'s file structure.
- `<SchemaCanvas>` registered under `renderer: "schema"`.
- Conditional dispatch in factory.ts — when `artifactKind ∈ {backend-rest-api, backend-graphql}`, dispatch `schema-architect` in place of `designer`.
- Canvas pause + selection mirroring `selectDesignDirection`.
- DB-grade data model with PK strategy, indexes, RLS policies, audit columns, constraints, migration hints, optional partitioning.
- REST + GraphQL via a `style` discriminator on the Contract; shared Entity / Field / Index / DataModel shapes.
- Three architectural directions per emit; user picks one via the existing `canvasPauseRegistry` mechanism.

### Out of v1, deferred

- Edit-in-place in the canvas (read + select only).
- Direct spec-graph writes — proposal lives in `priorArtifact`, not in `Endpoint`/`Model` nodes yet.
- 3-pass critique/revise — code scaffolded but gated OFF by `ATLAS_FF_SCHEMA_ARCHITECT_3PASS`.
- Test/run endpoints from the canvas.
- ER-diagram view of relationships.
- TimescaleDB / hypertables / extensions (would be a separate `extensions?: string[]` field at proposal level later).

### Robustness invariants

- Production-shaped interface from day one (proposal contract, canvas pause, selection action wired even on flag-off, just unreachable).
- Simplest correct backend — single-pass Sonnet, no spec-graph integration yet.
- Live path gated by `ATLAS_FF_SCHEMA_ARCHITECT` (default OFF). Flag-OFF behavior is byte-identical to today (backend rituals still crash; that's accepted until the user flips the flag).
- No half-broken middle state. Fallback path is the existing one, not a new partial implementation.

### Feature flags

| Flag | Default | Effect |
|---|---|---|
| `ATLAS_FF_SCHEMA_ARCHITECT` | `false` | ON: backend rituals dispatch the new role, canvas pauses, selection works. OFF: today's behavior unchanged. |
| `ATLAS_FF_SCHEMA_ARCHITECT_3PASS` | `false` | ON: draft → critique → revise (Sonnet → Haiku → Haiku) like designer. OFF: single-pass Sonnet. Code path scaffolded both ways. |

## 3. Architecture

### Ritual chain shapes

**Frontend (unchanged):**
```
Architect → Researcher → Designer → ── canvas pause ── → Developer → gates
```

**Backend (new):**
```
Architect → Researcher → SchemaArchitect → ── canvas pause ── → Developer → gates
```

The conductor sees the architect's `artifactKind` and dispatches the appropriate role in the slot. Frontend artifacts continue to use `designer`; backend artifacts use `schema-architect`. `data-pipeline`, `mobile-app`, `cli-tool` fall through to today's preview-only behavior (no design/schema gate).

### Canvas integration

`canvasModeRegistry.register("schema", SchemaCanvas)` in `register-renderers.tsx`. `<CanvasShell>` looks up `mode.renderer` strings already; no shell-side changes.

`<SchemaCanvas>` consumes:
- `useEventStream()` → finds the latest `schema_architect.proposal.emitted` event for this ritual.
- `useCanvasManifest()` → confirms the schema mode is active.

Selection flow re-uses `canvasPauseRegistry.waitForOption(ritualId)` from the engine side and `selectSchemaDirection` from the action side — same machinery the DesignerCanvas already uses.

### File layout

| File | New / Modified |
|---|---|
| `packages/role-schema-architect/package.json` | new |
| `packages/role-schema-architect/src/index.ts` | new |
| `packages/role-schema-architect/src/types.ts` | new (Zod schemas) |
| `packages/role-schema-architect/src/assemble-proposal.ts` | new (system prompt + tool-use schema + single-pass emit) |
| `packages/role-schema-architect/src/errors.ts` | new |
| `packages/role-schema-architect/src/role.ts` | new (Role implementation, single-pass + flagged 3-pass branches) |
| `packages/role-schema-architect/src/critique-prompt.ts` | new (v2 scaffold, flag-gated) |
| `packages/role-schema-architect/src/revise-prompt.ts` | new (v2 scaffold, flag-gated) |
| `packages/role-schema-architect/src/migration-hints.ts` | new (deterministic post-emit step for safety hints) |
| `packages/role-schema-architect/src/validate-references.ts` | new (cross-entity reference validator) |
| `packages/role-schema-architect/test/*.test.ts` | new (~45 cases across types/assemble/role/role-three-pass/migration-hints/validate-references) |
| `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx` | new |
| `apps/atlas-web/components/canvas/register-renderers.tsx` | modified (register `schema`) |
| `apps/atlas-web/lib/actions/selectSchemaDirection.ts` | new |
| `apps/atlas-web/lib/engine/factory.ts` | modified (conditional dispatch by artifactKind; new event-type mappings) |
| `apps/atlas-web/lib/feature-flags.ts` | modified (add 2 flags) |
| `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx` | new (~10 cases) |
| `apps/atlas-web/test/actions/selectSchemaDirection.test.ts` | new (~6 cases) |
| `apps/atlas-web/test/lib/engine/factory.test.ts` | modified (+3 cases — conditional-dispatch coverage) |
| `apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts` | new (6 Playwright cases — replaces existing placeholder fixture spec) |
| `apps/atlas-web/e2e/flow/backend-ritual-schema-pause.spec.ts` | new (3 cases — full flow drive) |

## 4. Data types

### Top level

```ts
SchemaProposal {
  recommended: SchemaDirection
  alternates: [SchemaDirection, SchemaDirection]   // tuple, exactly 2
  reasoning: string                                 // why recommended beats alternates
}

SchemaDirection {
  id: string                                       // kebab-case, e.g. "rest-crud"
  name: string                                     // "RESTful CRUD"
  shortDescription: string                         // one sentence, jargon-free
  technicalDescription: string                     // one sentence, names key choices
  contract: Contract                               // API surface
  dataModel: DataModel                             // DB-grade
}
```

### Contract (REST vs GraphQL discriminator)

```ts
Contract =
  | { style: "rest";    operations: RestOperation[] }
  | { style: "graphql"; operations: GraphqlOperation[] }

RestOperation {
  method: "GET"|"POST"|"PATCH"|"PUT"|"DELETE"
  path: string                                     // /users/:id
  summary: string
  requestSchema?: { fields: Field[] }              // reuses Field shape
  responseSchema?: { fields: Field[] }
  statusCodes: number[]                            // 200, 201, 400, 404, ...
}

GraphqlOperation {
  kind: "query"|"mutation"|"subscription"
  name: string                                     // listUsers, createUser
  summary: string
  args: Field[]
  returnType: string                               // entity name OR scalar OR [entity]
}
```

### Data model (DB-grade)

```ts
DataModel { entities: Entity[] }

Entity {
  name: string                                     // singular, snake_case
  description: string
  fields: Field[]
  primaryKey: { columns: string[]; strategy: "uuid"|"serial"|"composite" }
  indexes: Index[]                                 // separate from PK
  constraints: Constraint[]                        // CHECK, UNIQUE-group, EXCLUDE
  rls: RlsConfig
  audit: AuditConfig
  partitioning?: { kind: "range"|"list"|"hash"; on: string }
  migrationHints: string[]                         // post-emit, deterministic
  notes?: string                                   // schema-architect rationale, surfaced in canvas
}

Field {
  name: string                                     // snake_case
  type: PostgresType                               // canonical: uuid, text, int, bigint, numeric, timestamptz, jsonb, citext, ...
  nullable: boolean                                // explicit; default false
  default?: string                                 // SQL expr: gen_random_uuid(), now(), '...'
  references?: {
    entity: string
    field: string
    onDelete: "cascade"|"set null"|"restrict"|"no action"
    onUpdate?: "cascade"|"set null"|"restrict"|"no action"
  }
  generated?: { as: string; stored: boolean }      // generated columns
  description?: string
}

Index {
  name: string                                     // <table>_<cols>_<idx|uniq|gin>
  columns: string[]
  unique?: boolean
  where?: string                                   // partial-index predicate
  method?: "btree"|"gin"|"gist"|"hash"             // default btree
}

Constraint {
  type: "check"|"unique"|"exclude"
  name: string
  expression: string                               // raw SQL fragment
}

RlsConfig {
  enabled: boolean
  policies: RlsPolicy[]
}

RlsPolicy {
  name: string                                     // <table>_<verb>_<role>
  applyTo: "select"|"insert"|"update"|"delete"|"all"
  using: string                                    // SQL: e.g. "tenant_id = current_setting('app.tenant_id')::uuid"
  withCheck?: string
  role?: string                                    // default: PUBLIC
}

AuditConfig {
  createdAt: boolean                               // default true
  updatedAt: boolean                               // default true (with trigger)
  createdBy?: boolean                              // tracks user uuid
  deletedAt?: boolean                              // soft-delete
}

PostgresType =
  "uuid" | "text" | "citext" | "varchar"          // varchar discouraged
  | "int" | "bigint" | "smallint" | "numeric"
  | "boolean"
  | "timestamptz" | "timestamp" | "date" | "time" | "interval"
  | "jsonb" | "json"                              // json discouraged
  | "bytea"
  | "inet" | "cidr"
  | "geometry"                                     // PostGIS
  | string                                         // escape hatch for domain types
```

### Cross-entity validation

Inside `SchemaProposalSchema.refine(...)`:

- For every `Field.references`, `references.entity` must exist in `dataModel.entities[*].name`.
- For every `Field.references`, `references.field` must exist on the target entity.
- For every `Index.columns[*]`, the column must exist on the entity's `fields`.
- Field names unique within an entity.
- Entity names unique within a proposal.
- Operation paths/names unique within a direction.

Failures yield `{ reason: "broken-reference" | "duplicate-name" }` for auto-fix to consume.

## 5. Schema-architect prompt rules

The system prompt for `schema-architect` enforces these as hard rules (model is told to ALWAYS apply them; violations are reasons for auto-fix to retry):

1. **Primary keys.** Every entity has a stable PK with explicit `strategy`. Default `uuid` + `default: "gen_random_uuid()"`. `serial` discouraged; require justification.
2. **FK actions.** Every FK has an explicit `onDelete`. No defaults — modeling the cardinality decision is the point.
3. **FK indexes.** Every FK column gets an index unless explicitly suppressed in `notes`.
4. **Canonical types.**
   - `text` not `varchar(N)` (Postgres treats them the same internally; varchar adds friction).
   - `timestamptz` not `timestamp` (timezone-naive timestamps are a footgun).
   - `citext` for case-insensitive uniqueness (emails, usernames).
   - `numeric` with explicit precision for money; never `decimal` without precision.
   - `jsonb` not `json`; GIN-index it if queried.
5. **Multi-tenancy.** Any entity with a `tenant_id` (or analogous tenancy column) sets `rls.enabled: true` with a tenant-scoped `using` clause: `tenant_id = current_setting('app.tenant_id')::uuid`. One RLS policy per verb. Matches Atlas convention (see `packages/postgres-branching/` for the broader pattern).
6. **Audit defaults.** `created_at` + `updated_at` (with trigger) on every entity. `created_by` when tenancy is on. `deleted_at` (soft-delete) only when business reason exists in the brief.
7. **Enums.** Prefer `text` + `CHECK (col IN ('a','b','c'))` over `CREATE TYPE foo_enum AS ENUM(...)`. Postgres ENUM values cannot be removed without rewriting the type — disastrous for evolvability.
8. **Composite indexes.** Look for common query patterns the brief implies (e.g., tenant-scoped lists ordered by recency) and emit composite indexes: `(tenant_id, created_at DESC)`, `(user_id, status, created_at)`.
9. **Migration safety.** `migrationHints` populated deterministically post-emit (see Section 6): every new index on a presumed-large table → `CREATE INDEX CONCURRENTLY`; every new required column → staged-NOT-NULL pattern; every wide table-rewrite operation flagged.
10. **Three distinct directions.** The 3 directions must be **architecturally distinct**, not cosmetic variants. Examples:
    - RESTful CRUD vs RPC-style operations vs Event-sourced commands.
    - Normalized vs Embedded (jsonb-heavy) vs Hybrid.
    - Synchronous vs Async (outbox-pattern) vs CQRS-split.
    The `recommended` direction MUST cite WHY it's the best match for the brief.

## 6. Migration-hints generator

Deterministic post-emit step (`migration-hints.ts`). For each entity, given its index/field/constraint shape:

- For every new index on a table where `fields.length > 5` OR `entity.partitioning` is set: append `"CREATE INDEX CONCURRENTLY on '<entity>'.'<index_name>' to avoid blocking writes on a populated table."`
- For every newly-required column on what looks like an existing entity (heuristic: entity name matches common growth tables like `user`, `post`, `event`, `transaction`): append `"For '<field>': add as NULLable → backfill in batches → ALTER COLUMN SET NOT NULL once backfill is verified."`
- For `bigint` PK migration from `serial`: append the standard zero-downtime swap recipe.
- For new `unique` indexes that might collide: append `"Pre-flight check uniqueness BEFORE creating the unique index in production."`

This runs deterministically — no LLM call. Output is a string array displayed under the entity in the canvas.

## 7. Event flow

All events stamped with stable IDs `${projectId}:db-${rowId}` for the hydration dedupe path (already shipped via PR #2 D17).

```
ritual.started
  architect.deep_plan.completed       (existing; artifactKind=backend-rest-api/graphql)
  researcher.brief.completed          (existing; conditional on ATLAS_FF_RESEARCHER)
  schema_architect.proposal.started   NEW
  schema_architect.proposal.emitted   NEW   payload: { proposal: SchemaProposal }
  canvas.options.requested            (existing pause mechanism, reused)
  ── ritual pauses; user reviews SchemaCanvas; clicks "Use this" ──
  schema.direction.selected           NEW   payload: { directionId, direction: SchemaDirection }
  developer.code.started              (existing; priorArtifact gets `schemaProposal` + `selectedSchema`)
  ...
```

Event-type → broker mappings added to `apps/atlas-web/lib/engine/factory.ts`'s SSE forwarding switch.

## 8. Selection action

```ts
// apps/atlas-web/lib/actions/selectSchemaDirection.ts
export async function selectSchemaDirection({
  projectId,
  ritualId,
  direction
}: {
  projectId: string;
  ritualId: string;
  direction: SchemaDirection;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 1. authz: user owns project (RLS check via clerk-compat + projects repo)
  // 2. replay protection: validate `direction.id` matches one of the
  //    {recommended,alternates}.id from the most recent
  //    schema_architect.proposal.emitted event for this ritual
  // 3. EventBroker.publish("schema.direction.selected", { directionId, direction })
  // 4. canvasPauseRegistry.resolve(ritualId, { directionId: direction.id, direction })
  // 5. return { ok: true }
}
```

Mirrors `selectDesignDirection` in structure; failures return `{ ok: false, reason }` rather than throwing, so the canvas can render a toast without unmounting.

## 9. Canvas-side state machine

```
mount
  → wait for canvasManifest.modes contains "schema"
  → wait for schema_architect.proposal.emitted via useEventStream
  → render 3 cards (recommended + 2 alternates) with counts (op count, entity count)
  → user clicks card → setSelected(directionId)
     → expand split-pane below: Contract (left) | Data Model (right)
     → persona-aware density: ama sees fields-only; diego/priya see indexes/RLS/constraints/hints
  → user clicks "Use this direction"
     → call selectSchemaDirection({ projectId, ritualId, direction })
     → on ok=true: render "Selected — Developer building..." state
     → on ok=false: render toast with reason; keep cards interactive
  → SSE eventually delivers developer.code.started → manifest mode auto-switches to preview
     → CanvasShell swaps to PreviewCanvas; SchemaCanvas unmounts
```

## 10. Error handling

| Failure | Class / reason | Auto-fixable via Plan L? |
|---|---|---|
| LLM call fails (network, 5xx, timeout) | `SchemaArchitectFailedError { reason: "llm-error" }` | Yes |
| Tool-use payload fails Zod parse | `SchemaArchitectFailedError { reason: "schema-mismatch" }` (error message includes failing Zod path) | Yes |
| `references.entity` missing | `SchemaArchitectFailedError { reason: "broken-reference" }` | Yes |
| `references.field` missing on target | `SchemaArchitectFailedError { reason: "broken-reference" }` | Yes |
| Duplicate entity / field name | `SchemaArchitectFailedError { reason: "duplicate-name" }` | Yes |
| User abandons before clicking "Use this" | Existing canvas-pause timeout machinery | N/A |
| Canvas-side render error | UI error boundary; no impact on role | N/A |

Auto-fix loop (Plan L) consumes the error reason + message and prompts the schema-architect to repair the specific violation.

## 11. Testing strategy

TDD discipline — every red test before implementation. Total: ~73 new cases (~64 unit + ~9 E2E).

### Unit (~64 cases)

| File | Cases |
|---|---|
| `packages/role-schema-architect/test/types.test.ts` | ~12 — Zod acceptance/rejection per type; PK strategy enum; RLS shape; enum-via-CHECK contract; canonical-type whitelist |
| `.../test/assemble-proposal.test.ts` | ~8 — prompt assembly: brief/intent threading, REST vs GraphQL discriminator, audit defaults, distinctness rule |
| `.../test/validate-references.test.ts` | ~6 — broken-reference detection, multi-entity FK chains, self-references, composite-PK references |
| `.../test/migration-hints.test.ts` | ~5 — concurrent-index hint, NOT-NULL backfill hint, serial→bigint hint, unique-collision hint |
| `.../test/role.test.ts` | ~8 — role lifecycle: started/emitted/completed, throws on LLM error, broken-reference detection, single-pass branch by flag |
| `.../test/role-three-pass.test.ts` | ~6 — 3-pass wiring under flag: draft → critique → revise; skipped when flag off |
| `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx` | ~10 — 3 cards mount, click-to-expand, "Use this" wires to selectSchemaDirection, persona density, REST vs GraphQL op-rail switch, empty-state, toast on action error |
| `apps/atlas-web/test/actions/selectSchemaDirection.test.ts` | ~6 — authz, replay protection, event emission, canvasPauseRegistry.resolve, error handling, REST+GraphQL variants |
| `apps/atlas-web/test/lib/engine/factory.test.ts` | +3 — conditional dispatch: schema-architect for backend-*, NOT for frontend, NOT for cli-tool/data-pipeline/mobile-app |

### E2E (Playwright, ~9 cases)

| File | Cases |
|---|---|
| `apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts` | 6 — visual snapshot at canvas pause; 3 viewports × 2 personas. Replaces the existing placeholder fixture. |
| `apps/atlas-web/e2e/flow/backend-ritual-schema-pause.spec.ts` | 3 — full-flow drive: start ritual → pause at SchemaCanvas → click "Use this" → assert ritual resumes → assert developer phase fires. REST + GraphQL + an auto-fix retry on synthetic broken-reference. |

### TDD ordering (red-first)

1. `types.test.ts` — write Zod shapes red, then types.ts.
2. `validate-references.test.ts` — write cross-entity validation red, then refine() in types.ts.
3. `migration-hints.test.ts` — red, then migration-hints.ts.
4. `assemble-proposal.test.ts` — red, then assemble-proposal.ts.
5. `role.test.ts` — red, then role.ts (single-pass branch first).
6. `role-three-pass.test.ts` — red, then flag-gated branch.
7. `SchemaCanvas.test.tsx` — red, then renderer.
8. `selectSchemaDirection.test.ts` — red, then server action.
9. `factory.test.ts` updates — red, then conditional dispatch.
10. E2E specs last, against the live wiring.

## 12. Out of v1, on the radar

- **Edit-in-place** — let the user tweak entity fields / add an endpoint inline before approving. Likely needs a `<SchemaEditor>` sub-component.
- **Spec-graph integration** — emit `Endpoint` + `Model` nodes on selection; queries can then traverse the graph for impact analysis on refines.
- **ER-diagram view** — render the entity graph spatially, not just the field list.
- **3-pass critique + revise** — flag-gated v2; scaffolded in `critique-prompt.ts` / `revise-prompt.ts`.
- **TimescaleDB / extensions** — proposal-level `extensions?: string[]`.
- **Endpoint dry-run** — execute a sample request against the sandbox right from the canvas.

## 13. Acceptance criteria

- All unit + E2E tests green from a clean WSL `pnpm -r test` + `pnpm --filter atlas-web exec playwright test`.
- With `ATLAS_FF_SCHEMA_ARCHITECT=true`, a fresh backend-rest-api ritual flows: architect → researcher → schema-architect → canvas pause → user picks a direction → developer codes against that direction → preview renders. Same for backend-graphql.
- With `ATLAS_FF_SCHEMA_ARCHITECT=false`, behavior is byte-identical to today (backend rituals still hit the existing canvas-mismatch path; that's the known issue this PR un-fixes only when the flag is on).
- With `ATLAS_FF_SCHEMA_ARCHITECT_3PASS=true`, the role runs draft → critique → revise; 3-pass events emit; tests covering the branch pass.
- A synthetic broken-reference emit triggers auto-fix retry that repairs and succeeds within 3 attempts (Plan L invariant).
- Playwright visual snapshots match across 3 viewports × 2 personas.
- No TypeScript errors; no new ESLint warnings; no untyped `any` in the new package's src/.

## 14. Open questions to resolve at plan-writing or implementation

- **Schema-architect's model default.** Sonnet 4.5 single-pass per S3 designer's pattern, OR drop to Sonnet/Haiku based on cost? Decide at implementation; default Sonnet 4.5, env override via `ATLAS_LLM_SCHEMA_ARCHITECT_MODEL`.
- **Image-build pipeline** is irrelevant here (deferred per user direction).
- **E2E test fixture for the live ritual flow** — does atlas-web have an existing pattern for mocking LLM responses + driving the engine to a specific event? If not, the plan should include the harness. Investigate at planning time.
