# @atlas/spec-graph-schema

The canonical schema for the Atlas Spec Graph: 14 node types, 13 edge types, 14 structural invariants.

This is the **typed contract** that every Atlas surface reads — skill framework, conductor, merge gates, the Atlas backend, the public OSS skill library. It carries no runtime dependencies beyond Zod and exposes a pure `validate()` function.

## Install

```bash
pnpm add @atlas/spec-graph-schema
```

## Usage

```ts
import { validate, SpecGraphSchema, type SpecGraph } from "@atlas/spec-graph-schema";

// Validate an unknown shape
const result = validate(someJson);
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.code}: ${issue.message}`, issue.path);
  }
}

// Or parse with Zod directly for a fully-typed value
const graph: SpecGraph = SpecGraphSchema.parse(someJson);
```

## What this package contains

- `SpecGraphSchema` — the root object Zod schema (`z.discriminatedUnion`-backed)
- `NodeSchema` and `nodeRegistry` — 14 node types
- `EdgeSchema` and `edgeRegistry` — 13 edge types
- `validate(graph) → ValidationResult` — runs the structural Zod parse plus all 14 invariants
- `ALL_INVARIANTS` — the array of invariant functions, importable for partial runs
- A JSON Schema 2020-12 artifact at `dist/schema/spec-graph.v1.schema.json` for non-TS consumers (Python, Go, generated tooling)

## Node types (14)

`Page` · `Route` · `Component` · `ClientState` · `Model` · `Endpoint` · `Flow` · `AuthBoundary` · `Test` · `DesignToken` · `Dependency` · `ComplianceClass` · `AIFeature` · `MediaAsset`

## Edge types (13)

`renders` · `fetches` · `reads` · `mutates` · `requires` · `covers` · `dependsOn` · `styledBy` · `subjectTo` · `supersedes` · `powers` · `displays` · `manages`

## Structural invariants (14)

| # | Code | Summary |
|---|---|---|
| I01 | `I01_PAGE_MISSING_ROUTEREF` | Every Page must carry a `routeRef`. |
| I02 | `I02_ENDPOINT_MISSING_ROUTEREF` | Every Endpoint must carry a `routeRef`. |
| I03 | `I03_AUTH_PAGE_MISSING_BOUNDARY` | Pages with `authRequired: true` must `requires` an AuthBoundary. |
| I04 | `I04_PII_ENDPOINT_MISSING_AUTH` / `_COMPLIANCE` | Endpoints mutating a PII Model need both AuthBoundary and ComplianceClass edges. |
| I05 | `I05_PII_MODEL_MISSING_RLS` | Models with PII must have RLS policies for select/insert/update/delete. |
| I06 | `I06_DEPENDENCY_HAS_CRITICAL_CVE` | No critical-severity dependency CVEs (merge-blocker). |
| I07 | `I07_RENDERS_DANGLING_REF` / `_WRONG_KIND` | `renders` edges must target an existing Component. |
| I08 | `I08_BASELINE_COMPLIANCE_*` | Exactly one ComplianceClass with name `baseline`. |
| I09 | `I09_MISSING_TEST_COVERAGE` | Every Page, ClientState, Endpoint, Flow, AuthBoundary needs a `covers`-edge from at least one Test. |
| I10 | `I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE` | Personalized AIFeatures need a ComplianceClass. |
| I11 | `I11_GENERATED_MEDIA_MISSING_PROVIDER` | Generated MediaAssets need a `providerCapability`. |
| I12 | `I12_PII_CLIENTSTATE_MISSING_COMPLIANCE` | ClientState with PII needs a ComplianceClass. |
| I13 | `I13_PROTECTED_TARGET_MISSING_BASELINE_TEST` | AuthBoundaries, PII Models, and non-baseline ComplianceClasses each need at least one Test with `source: "baseline"`. |
| I14 | `I14_MEDIAASSET_KIND_PHASE_B` | MediaAsset.kind must be one of `image`, `icon`, `illustration` in v1. |

## Wire-up with `@atlas/spec-graph-data`

The data layer accepts the validator as an opt-in:

```ts
import { SpecGraphRepo, createDatabase } from "@atlas/spec-graph-data";
import { validate } from "@atlas/spec-graph-schema";

const db = createDatabase(process.env.DATABASE_URL!);
const repo = new SpecGraphRepo(db.pool, { validator: validate });

await repo.create(projectId, graphData); // throws GraphValidationError if invalid
```

Without the constructor flag, the data layer remains schema-agnostic (existing test code paths keep working).

## Extension surface

Every node carries an optional `extensions: Record<string, unknown>` field. Use it for custom attributes you don't want to fork the schema for. Validation is lenient on `extensions` and strict on every other field.

## Developing

```bash
pnpm -F @atlas/spec-graph-schema test
pnpm -F @atlas/spec-graph-schema build      # emits dist/ + dist/schema/spec-graph.v1.schema.json
pnpm -F @atlas/spec-graph-schema typecheck
```

No DB required — this package is pure unit code.
