# @atlas/role-architect

The first Role implementation for `@atlas/conductor` — the Architect performs two-pass ritual-authoring:

1. **Pass 1 — Ambiguity triage (Haiku 4.5).** Classifies the user's intent into one of 7 scopes (new-app, new-feature, bug-fix, dep-upgrade, refactor, ship, migrate) and flags blocker-severity questions that must be answered before the deep plan runs.
2. **Pass 2 — Deep plan (Opus 4.7).** Composes `brainstorm` + `spec-graph` + `runnable-plan` skills from `@atlas/skill-runtime` via a 3-tier prompt-cache (role prompt + graph slice + user turn) and produces the scope-specific Visualize artifact per PRD §8.

## Install

Workspace package. Deps: `@atlas/conductor`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`.

## Usage

```ts
import { ArchitectRole } from "@atlas/role-architect";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryFromBundledLibrary } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";

const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
const skills = createRegistryFromBundledLibrary();
const architect = new ArchitectRole({ llm: provider, skills });

const conductor = new Conductor({
  classifier: skillRuntimeClassifier,
  roles: new Map([["architect", architect]]),
  checkpointSink,
  sliceBuilder
});

await conductor.dispatch(dispatchContext);
```

## Scope outputs

Each Architect run emits one `ArchitectOutput` variant matching the classified scope:

| Scope | Artifact |
|---|---|
| `new-app` | SpecGraph + runnable plan |
| `new-feature` | impact-analysis diff plan |
| `bug-fix` | four-phase debug report |
| `dep-upgrade` | breaking-change matrix + rollback plan |
| `refactor` | before/after graph + behavior-preservation contract + regression tests |
| `ship` | rerunnable steps + rollback trigger |
| `migrate` | staged plan + compliance evidence |

## Events emitted

- `architect.pass1.started` / `architect.pass1.completed` / `architect.pass1.failed`
- `architect.triage.needs_input` — one per blocker question
- `architect.pass2.started` / `architect.pass2.completed` / `architect.pass2.failed`

## Observability

Inherited from `@atlas/llm-provider`: every LLM call emits an OpenTelemetry span (`llm.anthropic.call`) and increments `atlas_llm_provider_requests_total{provider,model,status}` + records latency in `atlas_llm_provider_latency_seconds`.

## What does NOT ship in D.2

- Real skill markdown files — those come from `@atlas/skill-library` (Plan C.2). This package uses fixture skills in its test tree and bundled skills in production.
- Parallel Developer runs — that's Plan D.3.
- The Agree UI surface — that's Unit E.
