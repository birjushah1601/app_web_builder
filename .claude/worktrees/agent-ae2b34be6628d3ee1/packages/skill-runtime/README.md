# @atlas/skill-runtime

The Atlas skill runtime — loads `*.md` skill files, parses their YAML frontmatter, and exposes a typed `SkillRegistry` with `get()`, `list()`, `activate()`, and `match()` operations.

## Install (monorepo)

This package is a private pnpm workspace package. It is not published to npm.

```bash
pnpm install  # from repo root
```

## Quick start

```ts
import { loadSkillsFromDir, createRegistryWithOverrides, MockIntentClassifier } from "@atlas/skill-runtime";

// Load skills from the user's local overrides directory
const localSkills = loadSkillsFromDir(".atlas/skills");

// Compose with bundled library (empty until C.2 ships)
const classifier = new MockIntentClassifier(localSkills.map(s => ({
  name: s.frontmatter.name,
  activate_on: s.frontmatter.activate_on
})));

const registry = createRegistryWithOverrides([], localSkills, classifier);

// Look up a skill by name
const skill = registry.get("brainstorm");

// Activate a skill with validated inputs
const record = registry.activate("brainstorm", { topic: "what should I build" });

// Classify intent and get matching skills
const matches = await registry.match("I want to brainstorm my app idea");
```

## Skill frontmatter shape

```yaml
---
name: brainstorm              # required; kebab/snake identifier, no spaces
description: "..."            # required; one-line human description
activate_on:                  # required; at least one intent string
  - brainstorm
  - explore
composes:                     # optional; list of skill names this skill invokes
  - another-skill
model_hint: claude-haiku-4-5  # optional; preferred model for this skill
inputs:                       # optional; Zod schema evaluated at load time
outputs:                      # optional; Zod schema evaluated at load time
---

# Body

Markdown instructions, checklists, and decision tables.
```

## Cross-field refinement (OQ8)

Skill `inputs`/`outputs` schemas that need cross-field validation on a discriminated union must use the split-then-superRefine pattern. **Do not call `.refine()` on a `z.discriminatedUnion()`** — Zod v3 rejects `ZodEffects` as a union member.

Reference implementation: `packages/spec-graph-schema/src/nodes/auth-boundary.ts` (`AuthBoundaryBaseSchema` + top-level `.superRefine`).

## Intent classifier

`IntentClassifier` is a provider-agnostic interface. C.1 ships `MockIntentClassifier` for tests and local development. The real Haiku-4.5-backed classifier is injected by D.1 (Conductor + LLM Provider Abstraction).

The `onClassification(result, latencyMs, cacheKey)` telemetry hook is part of the interface from day one, enabling NFR-13 (>80% prompt-cache hit rate) measurement as soon as D.1 wires the real provider.

## Pin file (`.atlas/skills/pin.json`)

```json
[
  { "skill": "brainstorm", "version": "1.0.0", "provenance": "bundled" },
  { "skill": "acme-auth",  "version": "2.1.0", "provenance": "https://registry.acme.com/skills" }
]
```

Loaded and validated at startup via `loadPinFile` + `checkPinVersions`. Version must be exact semver.

## Starter skill library

The ~35 starter skills (`brainstorm.md`, `tdd-feature.md`, etc.) will be bundled in `packages/skill-library/` and published to `github.com/atlas-labs/atlas-skills` when **C.2** lands. Until then, `loadBundledSkills()` returns an empty array and `createRegistryFromBundledLibrary()` returns an empty registry.

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `zod` | 3.23.8 | Frontmatter schema validation |
| `js-yaml` | 4.1.0 | YAML frontmatter parsing |
| `@atlas/spec-graph-schema` | workspace:* | `nodeRegistry` / `edgeRegistry` imports |

## Next plans

- **C.2 — Starter Skill Library & OSS pipeline:** authors the ~35 skills, CI validation, public repo mirror.
- **D.1 — Conductor + LLM Provider Abstraction:** injects the real Haiku-4.5 `IntentClassifier` implementation.
- **C.3 — Test-Generator Registry + Human Baseline Infrastructure:** test-generator invocation, drift detection.
