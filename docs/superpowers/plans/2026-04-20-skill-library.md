# Starter Skill Library + OSS Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/skill-library/` — the Atlas Starter Skill Library: ~39 markdown skills grouped by role (Architect, Developer, Debugger, Security, Accessibility, Reviewer, Ship, Test-Generators) with YAML frontmatter matching `SkillFrontmatterSchema` from `@atlas/skill-runtime`. Ship a frontmatter-validator CI script, a GitHub Actions workflow that validates on every PR, and a release workflow that mirrors tagged versions to the public `github.com/atlas-labs/atlas-skills` repo (public repo creation is a manual out-of-band step documented in the README). Replace `@atlas/skill-runtime.loadBundledSkills()` stub with a real implementation pointing at `packages/skill-library/skills/`.

**Architecture:** The skill library is a **pure-markdown package** — no runtime code, no TS types, no JS exports. Its `package.json` declares `@atlas/skill-runtime` as a dev dependency so the validator script can import `parseFrontmatter` + `validateFrontmatter`. The package ships two script entries: `validate` (runs the frontmatter validator over every `skills/**/*.md`) and `release` (prepares a tarball for the public repo mirror — the actual push is handled by the GitHub Actions release workflow). Skills are grouped under `skills/<role>/` directories that match the role names in PRD §11.3, so the bundled-library loader can optionally filter by role. A companion commit updates `@atlas/skill-runtime`'s `loadBundledSkills()` to resolve the library path relative to the monorepo root.

**Tech Stack:** Pure markdown + YAML frontmatter · pnpm workspace · `@atlas/skill-runtime` (workspace dev dep, for the validator) · TypeScript 5.6.3 (for the validator script) · Vitest 2.1.8 (for the validator test) · Node 22 LTS · GitHub Actions for CI + release. Apache 2.0 license.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan C.1 merged (`@atlas/skill-runtime` is in the workspace; `parseFrontmatter` and `validateFrontmatter` are callable).
- Node 22 LTS + pnpm 9+.
- No DB required — this package is pure content + one script.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  skill-library/                             # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    LICENSE                                  # Apache 2.0 boilerplate
    README.md                                # library usage, authoring guide, pin conventions
    scripts/
      validate-frontmatter.mjs               # iterates skills/**/*.md, asserts frontmatter conformance
    skills/
      architect/
        brainstorm.md
        spec-graph.md
        runnable-plan.md
        visualize-diff.md
        approve-or-reject.md
      developer/
        tdd-feature.md
        edit-only-what-changed.md
        refactor-without-regression.md
        upgrade-dependency-safely.md
      debugger/
        four-phase-debug.md
        incident-response.md
      security/
        audit-rls.md
        cors-policy.md
        secrets-scan.md
        cve-check.md
      accessibility/
        wcag-audit.md
        rtl-layout.md
        keyboard-nav.md
        contrast-check.md
      reviewer/
        reviewer-critique.md
        pr-summary.md
        release-notes.md
      ship/
        domain-dns-tls.md
        auth-wire.md
        payments-wire.md
        ship-with-rollback.md
      test-generators/
        gen-test-page.md
        gen-test-route.md
        gen-test-component.md
        gen-test-client-state.md
        gen-test-model.md
        gen-test-endpoint.md
        gen-test-flow.md
        gen-test-auth-boundary.md
        gen-test-test.md
        gen-test-design-token.md
        gen-test-dependency.md
        gen-test-compliance-class.md
        gen-test-ai-feature.md
        gen-test-media-asset.md
    test/
      validate-frontmatter.test.mjs          # node --test over the real skills/ tree

packages/skill-runtime/                       # MODIFIED
  src/helpers.ts                             # replace loadBundledSkills() stub with real path resolution
  test/bundled-library.test.ts               # new test asserting loadBundledSkills() returns >= 39 skills

.github/
  workflows/
    skill-library-ci.yml                     # NEW — on PR, runs pnpm -F @atlas/skill-library validate
    skill-library-release.yml                # NEW — on tag push, builds tarball + (manual) public-repo push

package.json                                  # MODIFIED — add `validate:skills` root script

docs/superpowers/plans/
  README.md                                  # MODIFIED — mark C.2 shipped + handoff to C.3
```

**Why this shape.** Grouping skills by role keeps ~39 files tractable — the bundled-library loader can filter (`loadBundledSkills({ role: "architect" })`) without re-scanning the whole tree. The validator lives as a Node `.mjs` (not TS) so it can run from CI without a TS build step; it uses `@atlas/skill-runtime`'s already-built `dist/`. GitHub Actions files live under `.github/workflows/` per convention.

---

## Frontmatter conventions

Every skill file starts with YAML frontmatter delimited by `---` lines. The `SkillFrontmatterSchema` from `@atlas/skill-runtime` defines the fields:

| Field | Required for all | Required for test generators | Notes |
|---|---|---|---|
| `name` | ✓ | ✓ | Kebab-case; must match filename stem |
| `description` | ✓ | ✓ | One-line summary; ≤140 chars |
| `activate_on` | recommended | ✓ | Pattern or intent tag; test generators use `node:<kind>` |
| `composes` | optional | optional | Array of skill names this skill invokes |
| `model_hint` | optional | optional | `"haiku"` / `"sonnet"` / `"opus"` — Conductor treats as advisory |
| `inputs` | optional | optional | Zod schema (as stringified JSON Schema, or skipped) |
| `outputs` | optional | optional | Same |

Skill body follows the Superpowers convention: `# Title`, `## When to use`, `## Checklist` (or equivalent section), optional `## Examples`, optional `## Anti-patterns`.

## Open-question resolutions

- **Unit C's OQ4 (OSS release cadence) → weekly patch, monthly minor.** Documented in `skill-library-release.yml` comments and in the README's "Release cadence" section.
- **Required frontmatter fields.** For all skills: `name` + `description`. For test generators: additionally `activate_on` with a node-kind pattern. The validator enforces this distinction by file path (skills under `skills/test-generators/` must carry `activate_on`).
- **Skill body size target.** 30–80 lines of prose. Under 30 → probably not useful; over 80 → split or move detail into a `reference/` subfile.

---

## Tasks

### Task 1: Scaffold `packages/skill-library/`

**Files:**
- Create: `packages/skill-library/package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`, `.gitignore`

No TDD — scaffolding. Verified by `pnpm install` + `pnpm -F @atlas/skill-library typecheck` succeeding.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/skill-library/skills/{architect,developer,debugger,security,accessibility,reviewer,ship,test-generators}
mkdir -p packages/skill-library/scripts packages/skill-library/test
```

- [ ] **Step 2: Write `packages/skill-library/package.json`**

```json
{
  "name": "@atlas/skill-library",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Atlas starter skill library — ~39 OSS skills (Apache 2.0)",
  "license": "Apache-2.0",
  "scripts": {
    "validate": "node scripts/validate-frontmatter.mjs",
    "test": "node --test test/validate-frontmatter.test.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@atlas/skill-runtime": "workspace:*",
    "@types/node": "22.9.0",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false
  },
  "include": ["scripts/**/*", "test/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`** (even though tests use `node --test`, keep config for parity)

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.mjs"] } });
```

- [ ] **Step 5: Write `LICENSE`** — Apache 2.0 boilerplate. Copy the canonical text from https://www.apache.org/licenses/LICENSE-2.0.txt into `packages/skill-library/LICENSE`.

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
.vitest-cache/
```

- [ ] **Step 7: Install + verify**

```bash
pnpm install
pnpm -F @atlas/skill-library typecheck
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/skill-library/ pnpm-lock.yaml
git commit -m "feat(skill-library): scaffold package with pnpm + Apache-2.0 license"
```

---

### Task 2: Author Architect skills (5 files)

**Files:**
- Create: `skills/architect/brainstorm.md`, `spec-graph.md`, `runnable-plan.md`, `visualize-diff.md`, `approve-or-reject.md`

No TDD — prose authoring. The validator added in Task 13 enforces frontmatter correctness; a post-task `pnpm -F @atlas/skill-library validate` smoke confirms every file parses.

- [ ] **Step 1: Write `skills/architect/brainstorm.md`**

````markdown
---
name: brainstorm
description: Explore user intent before committing to a spec graph; surface unknowns as structured questions
activate_on: "visualize"
model_hint: haiku
---

# Brainstorm

## When to use

The Architect role composes this skill as its first step whenever a user intent enters the Visualize phase. Use it to:

- Extract the product scope from a free-text request.
- Enumerate ambiguities (missing auth requirements, unstated compliance class, unclear data shape).
- Produce a structured `AmbiguityReport` that Pass 1 of the Architect role emits.

Do **not** use this skill to generate spec-graph nodes or wireframes — that is `spec-graph.md`. Brainstorm is a pre-step.

## Checklist

- [ ] Restate the user's intent in one sentence.
- [ ] Identify the **scope** (new-app / new-feature / bug-fix / upgrade / refactor / ship / migrate).
- [ ] List unknowns as questions, each tagged `severity: "blocker" | "recommended"`.
- [ ] Blockers: compliance class (HIPAA, GDPR, DPDP-India?), data-residency region, auth provider, DB provider, payment regions.
- [ ] Recommended: brand tokens, i18n targets, mobile/desktop priority, offline requirements.

## Output contract

```
AmbiguityReport {
  passed: boolean                # true if no blockers
  questions: Array<{ question, reason, severity }>
}
```

## Anti-patterns

- Do not invent a compliance class when the user didn't mention one — ask.
- Do not collapse multiple ambiguities into one multi-part question — the user should be able to answer each separately.
````

- [ ] **Step 2: Write `skills/architect/spec-graph.md`**

````markdown
---
name: spec-graph
description: Produce typed Spec Graph nodes + edges from a clarified intent; obeys @atlas/spec-graph-schema
activate_on: "visualize"
composes: ["brainstorm"]
model_hint: opus
---

# Spec Graph

## When to use

Called by Pass 2 of the Architect role, after `brainstorm` has cleared blockers. Produces a structured Spec Graph instance matching `@atlas/spec-graph-schema.SpecGraph` — 14 node types, 13 edge types.

## Checklist

- [ ] Enumerate Pages, Routes, Components, Models, Endpoints, Flows required by the intent.
- [ ] Wire edges: every Page carries a `routeRef`; every Endpoint carries a `routeRef`; PII Models carry RLS policies; AuthRequired Pages `requires` an AuthBoundary.
- [ ] Include one `ComplianceClass` node with `name: "baseline"` (required by invariant I08).
- [ ] Emit `covers`-edges from synthesised Tests to every Page/ClientState/Endpoint/Flow/AuthBoundary (I09).
- [ ] Produce Test nodes with `source: "baseline"` for every AuthBoundary, PII Model, and non-baseline ComplianceClass (I13).

## Output contract

A JSON object matching `SpecGraph` exactly. Run `validate()` from `@atlas/spec-graph-schema` before emitting; if any invariant fails, emit `architect.spec-graph.invariant_violation` event with the issue list and retry.

## Anti-patterns

- Do not invent node kinds outside the v1 taxonomy.
- Do not skip baseline tests because "it's a prototype" — they're mandatory for structural invariants.
````

- [ ] **Step 3: Write `skills/architect/runnable-plan.md`**

````markdown
---
name: runnable-plan
description: Translate a Spec Graph mutation into a task-level runnable plan (TDD-shaped) for the Developer role
activate_on: "visualize"
composes: ["spec-graph"]
model_hint: opus
---

# Runnable Plan

## When to use

Called by Pass 2 of the Architect role to produce the **Agree-worthy artifact**: a numbered task list where each task has Files (Create/Modify/Test), 5-8 TDD-shaped Steps (failing test → impl → pass → commit), exact commands, exact commit messages.

## Checklist

- [ ] One task per Spec Graph node or edge change (no "refactor X" catch-alls).
- [ ] Every task's first step writes a failing test.
- [ ] Every task's final step commits with a Conventional Commits prefix (`feat(pkg):`, `test(pkg):`, `fix(pkg):`).
- [ ] Every code block is complete — no `// similar to Task N`, no TODO.
- [ ] Include exact expected output for every command.
- [ ] Reference file paths relative to the repo root.

## Output contract

Markdown matching the shape of `docs/superpowers/plans/2026-04-19-spec-graph-schema.md` (B.1, the canonical plan-style reference).

## Anti-patterns

- Do not write "handle edge cases" or "add appropriate error handling" — enumerate the cases.
- Do not reference a type or function that is not defined within some task of the plan.
````

- [ ] **Step 4: Write `skills/architect/visualize-diff.md`**

````markdown
---
name: visualize-diff
description: Produce a persona-tiered diff summary of proposed graph changes for the Agree step
activate_on: "agree"
model_hint: sonnet
---

# Visualize Diff

## When to use

After the Architect role emits a proposed graph mutation, this skill produces the **diff view** the user approves at Agree. Persona-tiered per PRD §7:

- **Ama** sees plain-English additions/changes/removals.
- **Diego** sees the graph view with before/after node cards.
- **Priya** sees raw JSON diff.

## Checklist

- [ ] List new nodes (by kind, id, one-line summary).
- [ ] List removed nodes.
- [ ] List changed nodes (field-level before/after).
- [ ] List new/removed/changed edges.
- [ ] Flag any invariant-affecting changes (new AuthBoundary, new PII Model, compliance class change).
- [ ] Emit a "risk estimate" — low / medium / high — based on diff size + invariant touches.

## Output contract

Markdown with four sections: `## Additions`, `## Removals`, `## Changes`, `## Risk`.
````

- [ ] **Step 5: Write `skills/architect/approve-or-reject.md`**

````markdown
---
name: approve-or-reject
description: Persona-gated approval decision recorder for the Agree step
activate_on: "agree"
composes: ["visualize-diff"]
model_hint: haiku
---

# Approve or Reject

## When to use

Records the user's Agree-step decision as a typed event persisted to `@atlas/spec-graph-data.spec_events`. Persona rules from PRD §9.5 apply.

## Checklist

- [ ] Require 20+ chars of rationale for any risk-accept (per Unit F's RiskAccepted schema).
- [ ] Ama cannot emit `gate: "L4-security"` risk-accepts — escalate to Priya.
- [ ] Emit `ritual.agreed` with the approved artifact + decision metadata.
- [ ] On rejection, emit `ritual.rejected` + rationale + route back to Visualize.

## Output contract

One of two event shapes: `{ type: "ritual.agreed", artifact, approvedBy, timestamp }` or `{ type: "ritual.rejected", reason, routeBackTo: "visualize" }`.

## Anti-patterns

- Do not silently accept empty rationale.
- Do not allow Ama to bypass Security/Compliance risk-accepts.
````

- [ ] **Step 6: Commit**

```bash
git add packages/skill-library/skills/architect/
git commit -m "feat(skill-library): add 5 Architect skills (brainstorm, spec-graph, runnable-plan, visualize-diff, approve-or-reject)"
```

---

### Task 3: Author Developer skills (4 files)

**Files:**
- Create: `skills/developer/tdd-feature.md`, `edit-only-what-changed.md`, `refactor-without-regression.md`, `upgrade-dependency-safely.md`

- [ ] **Step 1: Write `skills/developer/tdd-feature.md`**

````markdown
---
name: tdd-feature
description: Implement a feature TDD-style — failing test first, minimal code to pass, commit, refactor
activate_on: "build"
model_hint: sonnet
---

# TDD Feature

## When to use

The canonical Developer-role skill for any new feature. Runs once per task in a runnable plan.

## Checklist

- [ ] Read the task's Files section — know what to create/modify/test.
- [ ] Write the failing test first, complete (no `...` or `TODO`).
- [ ] Run the test to confirm it fails for the right reason (not a syntax error).
- [ ] Write the minimal implementation. Resist the urge to over-build.
- [ ] Run the test to confirm it passes.
- [ ] Commit with the exact message from the plan's step.

## Anti-patterns

- Do not skip Step 2 (confirm fail). A test that accidentally passes is worse than no test.
- Do not add features the task didn't ask for (YAGNI).
- Do not implement before the failing test is in place.
````

- [ ] **Step 2: Write `skills/developer/edit-only-what-changed.md`**

````markdown
---
name: edit-only-what-changed
description: Make the smallest possible edit that satisfies a task; avoid drive-by changes
activate_on: "build"
model_hint: sonnet
---

# Edit Only What Changed

## When to use

Every Developer-role task. The merge gate rejects diffs that touch files outside the task's declared Files section.

## Checklist

- [ ] Before editing, read the task's Files section. Touch only those paths.
- [ ] If the fix seems to require a drive-by edit elsewhere, stop and escalate — the plan is wrong, fix it first.
- [ ] Do not reformat, rename, or refactor outside the task scope.
- [ ] Commit message mentions only the task's subject.

## Anti-patterns

- Do not "while I'm here" fix an unrelated linter warning.
- Do not bump dependency versions in a feature task — that's a `upgrade-dependency-safely` task.
````

- [ ] **Step 3: Write `skills/developer/refactor-without-regression.md`**

````markdown
---
name: refactor-without-regression
description: Restructure code without changing behavior; preserve observable contracts and tests
activate_on: "build"
model_hint: sonnet
---

# Refactor Without Regression

## When to use

Refactor-scope tasks per PRD §8. Behavior-preservation is the contract.

## Checklist

- [ ] Record the **before** state: existing public API, existing tests, existing observable behavior.
- [ ] Ensure all existing tests pass before the refactor begins.
- [ ] Change structure in small steps, running the test suite after each step.
- [ ] Do not change public API surfaces unless the refactor explicitly widens or narrows them.
- [ ] Do not delete tests — if a test no longer applies, explain in the commit body.
- [ ] Final state: all previous tests green + any new tests for newly-exposed seams.

## Anti-patterns

- Do not mix refactor + feature work in one commit.
- Do not chase "cleaner" code into a different public API — that's a breaking change, not a refactor.
````

- [ ] **Step 4: Write `skills/developer/upgrade-dependency-safely.md`**

````markdown
---
name: upgrade-dependency-safely
description: Bump a dependency version with a breaking-change matrix, test-suite replay, and rollback plan
activate_on: "build"
model_hint: sonnet
---

# Upgrade Dependency Safely

## When to use

Dep-upgrade-scope tasks per PRD §8. Produces the artifact the Agree step expects: breaking-change matrix + compatibility assessment + rollback plan.

## Checklist

- [ ] Identify the version delta (current → target).
- [ ] Read the upstream changelog between these versions; extract breaking changes as a table.
- [ ] Find every callsite in the repo touching the dep's public API.
- [ ] For each breaking change: enumerate the callsites it affects + the migration step.
- [ ] Run the full test suite against the new version in an isolated branch.
- [ ] Record a rollback plan: exact commands to revert (git + pnpm install + DB migration rollback if applicable).

## Anti-patterns

- Do not bump major versions without a matrix.
- Do not skip test-suite replay with a "CI will catch it" — if CI finds it, the matrix was incomplete.
````

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/skills/developer/
git commit -m "feat(skill-library): add 4 Developer skills (tdd-feature, edit-only, refactor, upgrade-dep)"
```

---

