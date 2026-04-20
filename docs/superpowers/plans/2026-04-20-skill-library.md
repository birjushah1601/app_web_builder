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

### Task 4: Author Debugger skills (2 files)

**Files:** `skills/debugger/four-phase-debug.md`, `incident-response.md`

- [ ] **Step 1: Write `skills/debugger/four-phase-debug.md`**

````markdown
---
name: four-phase-debug
description: Reproduce → isolate → hypothesize → verify; never guess, always measure
activate_on: "bug-fix"
model_hint: sonnet
---

# Four-Phase Debug

## When to use

The canonical skill for any bug-fix-scope task. Produces the artifact the Agree step expects: a four-phase debug report with identified root cause.

## Checklist

- [ ] **Phase 1 — Reproduce.** Run the code. Observe the bug. Record exact steps + environment. If it cannot be reproduced, the bug is a hypothesis, not a fact.
- [ ] **Phase 2 — Isolate.** Narrow the failure region. Bisect. Remove unrelated variables. Produce a minimal failing case.
- [ ] **Phase 3 — Hypothesize.** State the suspected root cause in one sentence. Predict what would happen if the hypothesis is correct AND wrong.
- [ ] **Phase 4 — Verify.** Run the experiment that discriminates between "hypothesis correct" and "hypothesis wrong." Record the outcome.
- [ ] Only after Phase 4 passes: implement the fix + write a regression test.

## Anti-patterns

- Do not skip Phase 1 because "I know what the bug is." You don't.
- Do not conflate hypotheses. Test one thing at a time.
- Do not ship a fix without a regression test — the bug will recur.
````

- [ ] **Step 2: Write `skills/debugger/incident-response.md`**

````markdown
---
name: incident-response
description: Production incident triage — stabilize first, understand second, fix third
activate_on: "incident"
composes: ["four-phase-debug"]
model_hint: sonnet
---

# Incident Response

## When to use

Production alert fires, or a user reports a live outage. Not for local dev failures — those use `four-phase-debug` directly.

## Checklist

- [ ] **Stabilize.** Roll back the most recent deploy if the incident started within its window. Pause non-critical traffic if the error rate is > baseline × 5.
- [ ] **Communicate.** Post an incident start timestamp to the team channel. Post every 15 minutes until resolved.
- [ ] **Triage scope.** Is this a full outage (dashboard down, 5xx on /)? Partial (one route, one region, one tenant)? Degraded (latency + success)?
- [ ] **Gather evidence.** Logs, traces, metrics, recent commits, recent config changes, upstream provider status pages.
- [ ] **Handoff to four-phase-debug** once stabilised. The incident is closed when the fix has landed + a post-mortem is scheduled.

## Anti-patterns

- Do not hot-fix in prod before stabilising. A bad hot-fix extends the incident.
- Do not skip the post-mortem. The cost is low; the learning is high.
````

- [ ] **Step 3: Commit**

```bash
git add packages/skill-library/skills/debugger/
git commit -m "feat(skill-library): add 2 Debugger skills (four-phase-debug, incident-response)"
```

---

### Task 5: Author Security skills (4 files)

**Files:** `skills/security/audit-rls.md`, `cors-policy.md`, `secrets-scan.md`, `cve-check.md`

- [ ] **Step 1: Write `skills/security/audit-rls.md`**

````markdown
---
name: audit-rls
description: Verify every PII-bearing Model has Row-Level-Security policies covering select/insert/update/delete
activate_on: "merge-gate.security"
model_hint: opus
---

# Audit RLS

## When to use

L4 merge gate. Runs on every diff that touches a Model node with `piiFields: [...]`.

## Checklist

- [ ] For every Model with `piiFields` non-empty: confirm `rlsPolicies` covers all four of `select`, `insert`, `update`, `delete`.
- [ ] Each policy must reference the tenant identity (`auth.uid()` or equivalent).
- [ ] Reject policies that use `USING (true)` — that's a missing policy, not a real one.
- [ ] Confirm invariant I05 passes (`I05_PII_MODEL_MISSING_RLS` not in validator output).

## Anti-patterns

- Do not accept "we'll add RLS later" — L4 is a blocker gate.
- Do not accept RLS policies that depend on app-level role claims without a DB-level check.
````

- [ ] **Step 2: Write `skills/security/cors-policy.md`**

````markdown
---
name: cors-policy
description: Enforce explicit CORS allowlists on every Endpoint; reject wildcards on credentialed routes
activate_on: "merge-gate.security"
model_hint: sonnet
---

# CORS Policy

## When to use

L4 merge gate. Runs on every diff that creates or modifies an Endpoint.

## Checklist

- [ ] Every Endpoint declares `cors.allowedOrigins` — a concrete list of origins or `"same-origin"`.
- [ ] Reject `cors.allowedOrigins: ["*"]` on any Endpoint where `cors.allowCredentials: true` — spec forbids it.
- [ ] Reject implicit CORS (no field) — every Endpoint must opt in explicitly.
- [ ] Allowed origins must be https:// except for `localhost` in development builds.

## Anti-patterns

- Do not whitelist a third-party origin without a signed data-processing agreement.
````

- [ ] **Step 3: Write `skills/security/secrets-scan.md`**

````markdown
---
name: secrets-scan
description: Block commits that include literal secrets; route all secret-like values through env/secret-manager
activate_on: "merge-gate.security"
model_hint: haiku
---

# Secrets Scan

## When to use

L4 merge gate. Runs on every diff.

## Checklist

- [ ] Scan diff for high-entropy strings (AWS keys, Stripe secret keys, JWT signatures, Postgres URLs with password).
- [ ] Match known patterns: `AKIA[0-9A-Z]{16}`, `sk_live_[0-9a-zA-Z]{24,}`, `postgresql://[^:]+:[^@]+@`, `-----BEGIN (RSA )?PRIVATE KEY-----`.
- [ ] Reject any literal match. The fix is always: move the value to an env var or secret manager + reference by `connectionStringRef: "env:VAR_NAME"`.
- [ ] Confirm no `.env*` files are being committed unless they're `.env.example` with placeholder values.

## Anti-patterns

- Do not rely on `.gitignore` as the only defence — the scan must run on the diff, not on the working tree.
````

- [ ] **Step 4: Write `skills/security/cve-check.md`**

````markdown
---
name: cve-check
description: Fail the merge if any Dependency node carries a critical or high CVE; update + retest
activate_on: "merge-gate.security"
model_hint: haiku
---

# CVE Check

## When to use

L4 merge gate + nightly CI job. Runs on the Spec Graph's Dependency nodes + the `package.json` / `pyproject.toml` lock files.

## Checklist

- [ ] Fetch the CVE database (npm audit, pip-audit, osv.dev) for every direct + transitive dependency.
- [ ] Fail on `critical` severity. Fail on `high` that has a patch available. Warn on `high` without patch.
- [ ] Confirm invariant I06 passes (`I06_DEPENDENCY_HAS_CRITICAL_CVE` not in validator output).
- [ ] When a CVE patches to a new version, the fix is an `upgrade-dependency-safely` task — do not hot-patch lock files directly.

## Anti-patterns

- Do not suppress a CVE with "it's not exploitable in our context" without a written security review.
````

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/skills/security/
git commit -m "feat(skill-library): add 4 Security skills (audit-rls, cors-policy, secrets-scan, cve-check)"
```

---

### Task 6: Author Accessibility skills (4 files)

**Files:** `skills/accessibility/wcag-audit.md`, `rtl-layout.md`, `keyboard-nav.md`, `contrast-check.md`

- [ ] **Step 1: Write `skills/accessibility/wcag-audit.md`**

````markdown
---
name: wcag-audit
description: Run axe-core against every Page; fail the merge on any WCAG 2.2 AA violation
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# WCAG Audit

## When to use

L5 merge gate. Runs on every diff that creates or modifies a Page.

## Checklist

- [ ] Run axe-core against the rendered Page (in the E2B sandbox or a headless Playwright).
- [ ] Fail on any WCAG 2.2 AA violation.
- [ ] Report violations with: rule, impact, element selector, remediation hint.
- [ ] Do not accept "false positive" without a code annotation explaining why + a dated TODO to revisit.

## Anti-patterns

- Do not rely on the designer's "it looked fine" — axe catches things the eye doesn't.
````

- [ ] **Step 2: Write `skills/accessibility/rtl-layout.md`**

````markdown
---
name: rtl-layout
description: Verify layouts render correctly in RTL scripts (Arabic, Hebrew); no left/right hardcoded spacing
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# RTL Layout

## When to use

L5 merge gate. Runs on every Page that targets locales including Arabic, Hebrew, or Urdu.

## Checklist

- [ ] Confirm `<html dir="...">` is set from the locale, not hardcoded.
- [ ] Reject hardcoded `margin-left`/`padding-right` etc.; prefer `margin-inline-start`/`padding-inline-end`.
- [ ] Icons with directional semantics (arrows, chevrons) must flip under RTL. Use `transform: scaleX(-1)` or mirrored assets.
- [ ] Test the Page rendered under `dir="rtl"` in CI via Playwright; snapshot-compare key regions.

## Anti-patterns

- Do not use `text-align: left` — use `start`.
````

- [ ] **Step 3: Write `skills/accessibility/keyboard-nav.md`**

````markdown
---
name: keyboard-nav
description: Every interactive element reachable + operable via keyboard; focus visible; logical tab order
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# Keyboard Navigation

## When to use

L5 merge gate. Runs on every Page.

## Checklist

- [ ] Every Component with an `onClick` handler also has an `onKeyDown` that triggers on Enter/Space, OR is rendered as a semantic `<button>`/`<a>`.
- [ ] Focus is visible — no `outline: none` without a replacement.
- [ ] Tab order follows visual order (no negative tabindex except for programmatically-focused containers).
- [ ] Modal dialogs trap focus + restore on close.

## Anti-patterns

- Do not use `<div onClick>` without `role="button"` + `tabindex="0"` + keyboard handler.
````

- [ ] **Step 4: Write `skills/accessibility/contrast-check.md`**

````markdown
---
name: contrast-check
description: WCAG 2.2 AA contrast ratios across text + icons in both light and dark modes
activate_on: "merge-gate.a11y"
model_hint: haiku
---

# Contrast Check

## When to use

L5 merge gate. Runs on every Page + every DesignToken that defines a color pair.

## Checklist

- [ ] Text: foreground/background contrast ≥ 4.5:1 for body, ≥ 3:1 for large text (18pt regular or 14pt bold).
- [ ] UI components + icons: ≥ 3:1 against adjacent surfaces.
- [ ] Run the check in both light and dark modes if the app supports theme switch.
- [ ] DesignToken pairs that fail → the DesignToken is rejected, not the Page.

## Anti-patterns

- Do not use gray-on-white body text below 4.5:1 "for aesthetic reasons."
````

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/skills/accessibility/
git commit -m "feat(skill-library): add 4 Accessibility skills (wcag-audit, rtl-layout, keyboard-nav, contrast-check)"
```

---

### Task 7: Author Reviewer skills (3 files)

**Files:** `skills/reviewer/reviewer-critique.md`, `pr-summary.md`, `release-notes.md`

- [ ] **Step 1: Write `skills/reviewer/reviewer-critique.md`**

````markdown
---
name: reviewer-critique
description: Critique a Developer-role diff against plan + quality bar before the user sees it
activate_on: "build"
model_hint: sonnet
---

# Reviewer Critique

## When to use

After the Developer role produces a diff, before the user sees it. The Reviewer role composes this skill.

## Checklist

- [ ] Diff matches the task's Files section (no drive-bys).
- [ ] Every task step's test was actually written and passes.
- [ ] Commit message matches the plan's exact message.
- [ ] No `console.log`, no `TODO:`, no leftover scaffolding.
- [ ] Public API changes (if any) are intentional + documented.
- [ ] Types are tight (no unexplained `any` / `unknown`).
- [ ] Critique is terse and specific — cite file:line references.

## Output contract

Structured: `{ status: "approved" | "changes_requested", issues: Array<{ severity, file, line, message }> }`.

## Anti-patterns

- Do not rubber-stamp "looks good" — if there are no issues, list strengths so future-you can calibrate.
````

- [ ] **Step 2: Write `skills/reviewer/pr-summary.md`**

````markdown
---
name: pr-summary
description: Produce a reviewer-friendly PR description from a reviewed diff
activate_on: "build"
composes: ["reviewer-critique"]
model_hint: haiku
---

# PR Summary

## When to use

After reviewer-critique approves, before the PR opens.

## Checklist

- [ ] **Summary**: 1–3 bullets describing what changed + why.
- [ ] **Test plan**: markdown checklist of TODOs for testing the PR.
- [ ] **Risk**: low / medium / high + one-line justification.
- [ ] **Rollback**: one sentence describing how to revert if needed.

## Anti-patterns

- Do not paste the full diff into the description — link to it.
````

- [ ] **Step 3: Write `skills/reviewer/release-notes.md`**

````markdown
---
name: release-notes
description: Generate user-facing release notes from a batch of merged PRs
activate_on: "release"
model_hint: sonnet
---

# Release Notes

## When to use

Called before every tagged release (weekly patch cadence per Unit C OQ4).

## Checklist

- [ ] Group changes by audience: "For builders", "For developers", "For platform admins".
- [ ] Lead with user-visible changes. Omit internal refactors unless they affect behaviour.
- [ ] Highlight breaking changes with a ⚠ marker + migration note.
- [ ] Credit external contributors by GitHub handle.

## Anti-patterns

- Do not publish "various improvements and bug fixes" — name them.
````

- [ ] **Step 4: Commit**

```bash
git add packages/skill-library/skills/reviewer/
git commit -m "feat(skill-library): add 3 Reviewer skills (reviewer-critique, pr-summary, release-notes)"
```

---

### Task 8: Author Ship skills (4 files)

**Files:** `skills/ship/domain-dns-tls.md`, `auth-wire.md`, `payments-wire.md`, `ship-with-rollback.md`

- [ ] **Step 1: Write `skills/ship/domain-dns-tls.md`**

````markdown
---
name: domain-dns-tls
description: Provision a custom domain with Let's Encrypt TLS + CAA record + HTTPS-redirect
activate_on: "ship"
model_hint: sonnet
---

# Domain / DNS / TLS

## When to use

Ship-scope tasks that attach a custom domain to a deployed app.

## Checklist

- [ ] Add A/AAAA/ALIAS record pointing at the platform's ingress.
- [ ] Add CAA record restricting issuance to Let's Encrypt.
- [ ] Provision TLS via Let's Encrypt ACME HTTP-01 or DNS-01 challenge.
- [ ] Enforce HTTPS-redirect via 301.
- [ ] Set HSTS with `max-age=31536000; includeSubDomains` (no preload until validated).

## Anti-patterns

- Do not use self-signed certs in prod.
- Do not skip CAA — it's a cheap defence against mis-issuance.
````

- [ ] **Step 2: Write `skills/ship/auth-wire.md`**

````markdown
---
name: auth-wire
description: Wire the chosen auth provider (Clerk / Supabase Auth / Lucia) into the deployed app
activate_on: "ship"
model_hint: sonnet
---

# Auth Wire

## When to use

Ship-scope tasks after the user has selected an auth provider at Visualize.

## Checklist

- [ ] Provision OAuth apps in the provider dashboard; store client IDs/secrets in the secret manager.
- [ ] Wire the provider's SDK into the app with the correct redirect URLs (production domain, not localhost).
- [ ] Confirm every AuthRequired Page redirects to the sign-in flow.
- [ ] Verify session persistence across reloads + cookie SameSite/Secure flags.
- [ ] Run a smoke test: sign-up → email verify → sign-in → protected page → sign-out.

## Anti-patterns

- Do not hardcode provider URLs in code — use env-referenced config.
- Do not ship with provider test keys ("pk_test_..."); always switch to live keys pre-launch.
````

- [ ] **Step 3: Write `skills/ship/payments-wire.md`**

````markdown
---
name: payments-wire
description: Wire Stripe (or regional alt) with idempotency keys, webhook signatures, reconciliation
activate_on: "ship"
model_hint: opus
---

# Payments Wire

## When to use

Ship-scope tasks that enable payments on the deployed app.

## Checklist

- [ ] Use idempotency keys on every payment-creation call (replay-safe).
- [ ] Verify webhook signatures; reject unsigned or stale webhooks (>5 min).
- [ ] Store raw webhook bodies for reconciliation.
- [ ] Tax handling: select the right tax provider per region (Stripe Tax, custom, or out-of-scope).
- [ ] PCI scope: never store card data; always hand off to provider-hosted forms (Checkout, Elements).
- [ ] Reconciliation: nightly job compares provider-side balances to app-side records; alert on drift > 0.01%.

## Anti-patterns

- Do not store PANs.
- Do not skip webhook signature verification — it's the only thing standing between you and a malicious caller forging a "paid" status.
````

- [ ] **Step 4: Write `skills/ship/ship-with-rollback.md`**

````markdown
---
name: ship-with-rollback
description: Deploy with a one-click armed rollback; health-check + auto-revert on red
activate_on: "ship"
model_hint: sonnet
---

# Ship With Rollback

## When to use

Every Ship-scope task.

## Checklist

- [ ] Pre-deploy: snapshot the current prod version (tag + container digest).
- [ ] Deploy to a canary / preview environment first.
- [ ] Run post-deploy health checks (HTTP 200 on /, critical route latency < baseline × 2, error rate < baseline × 1.5).
- [ ] Arm a one-click rollback: revert to the snapshot + rerun migrations down if DB changes.
- [ ] For DB migrations: separate migrate-up from deploy; run the migration first with a `pg_locks` timeout; deploy only if the migration succeeds.
- [ ] Auto-revert on red: if health checks fail within N minutes post-deploy, roll back without user confirmation.

## Anti-patterns

- Do not deploy code + DB migration in one atomic step unless you can truly atomic-rollback both.
- Do not disable auto-revert for "this one critical deploy."
````

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/skills/ship/
git commit -m "feat(skill-library): add 4 Ship skills (domain-dns-tls, auth-wire, payments-wire, ship-with-rollback)"
```

---

### Task 9: Author Test-Generator skills — batch 1 (5 files)

**Files:** `skills/test-generators/gen-test-page.md`, `gen-test-route.md`, `gen-test-component.md`, `gen-test-client-state.md`, `gen-test-model.md`

Test generators have a stricter frontmatter contract: `activate_on: "node:<kind>"` is required. Each generator produces baseline tests that the `@atlas/skill-runtime.SkillRegistry` can invoke when a graph mutation lands on a node of that kind.

- [ ] **Step 1: Write `skills/test-generators/gen-test-page.md`**

````markdown
---
name: gen-test-page
description: Generate Playwright + visual-diff + accessibility baseline tests for a Page node
activate_on: "node:page"
model_hint: sonnet
---

# Generate Test — Page

## When to use

Auto-activated when a `Page` node is added or its `path`/`title`/`renderMode`/`authRequired`/`routeRef` changes.

## Checklist

- [ ] Playwright test: navigate to Page.path, assert response 200, assert `<title>` contains Page.title.
- [ ] Axe-core test: run on the rendered Page, assert no WCAG 2.2 AA violations.
- [ ] Visual-diff test: screenshot the Page at 1440×900 + 375×667; compare to baseline.
- [ ] If authRequired=true, also: unauthed visit redirects to the AuthBoundary's sign-in path.
- [ ] Emit as a Test node in the Spec Graph with `source: "baseline"` and `covers`-edge → Page.

## Anti-patterns

- Do not generate tests that depend on specific content strings unless the Page has content fixtures. Test structure + semantics, not copy.
````

- [ ] **Step 2: Write `skills/test-generators/gen-test-route.md`**

````markdown
---
name: gen-test-route
description: Generate HTTP contract tests for a Route node (method + path + status)
activate_on: "node:route"
model_hint: haiku
---

# Generate Test — Route

## When to use

Auto-activated when a `Route` node is added or its `method`/`path`/`auth` changes.

## Checklist

- [ ] HTTP test: fetch Route.path with Route.method; assert expected status (200/201/204 for happy path per method).
- [ ] Auth test: if Route carries an AuthBoundary requires-edge, assert unauthed call returns 401 / 403.
- [ ] Handler-type test: if Route.handlerType is `"server-action"`, assert the form submit round-trip; if `"api"`, assert JSON response shape.
- [ ] Emit as Test node with `covers`-edge → Route.
````

- [ ] **Step 3: Write `skills/test-generators/gen-test-component.md`**

````markdown
---
name: gen-test-component
description: Generate React Testing Library tests for a Component node
activate_on: "node:component"
model_hint: haiku
---

# Generate Test — Component

## When to use

Auto-activated when a `Component` node is added or its props/state/events change.

## Checklist

- [ ] Render test: the component renders without throwing given minimal valid props.
- [ ] Props-matrix test: every prop variant documented in the Component produces the expected structure.
- [ ] Event test: every documented event handler fires with expected payload.
- [ ] Emit as Test node with `covers`-edge → Component.
````

- [ ] **Step 4: Write `skills/test-generators/gen-test-client-state.md`**

````markdown
---
name: gen-test-client-state
description: Generate state-machine tests for a ClientState node (transitions + invariants)
activate_on: "node:clientstate"
model_hint: sonnet
---

# Generate Test — ClientState

## When to use

Auto-activated when a `ClientState` node is added or its states/transitions change.

## Checklist

- [ ] Initial-state test: the state machine starts in the declared initial state.
- [ ] Transition tests: each declared (from → event → to) transition works.
- [ ] Illegal-transition test: events not in the transition table are rejected.
- [ ] Persistence test: if ClientState.persistence is `"localStorage"` or `"url"`, assert round-trip across reloads.
- [ ] Emit as Test node with `covers`-edge → ClientState.
````

- [ ] **Step 5: Write `skills/test-generators/gen-test-model.md`**

````markdown
---
name: gen-test-model
description: Generate DB-contract tests for a Model node (schema + RLS + CRUD)
activate_on: "node:model"
model_hint: sonnet
---

# Generate Test — Model

## When to use

Auto-activated when a `Model` node is added or its fields / RLS / indexes change.

## Checklist

- [ ] Schema test: inserting a row with all required fields succeeds; missing fields fail.
- [ ] RLS test: two tenants cannot read each other's rows; each CRUD op is tested per tenant.
- [ ] Index test: queries using declared indexes use them (EXPLAIN ANALYZE spot-check).
- [ ] PII test: if piiFields is non-empty, confirm RLS covers all four ops (I05).
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → Model.
````

- [ ] **Step 6: Commit**

```bash
git add packages/skill-library/skills/test-generators/gen-test-page.md packages/skill-library/skills/test-generators/gen-test-route.md packages/skill-library/skills/test-generators/gen-test-component.md packages/skill-library/skills/test-generators/gen-test-client-state.md packages/skill-library/skills/test-generators/gen-test-model.md
git commit -m "feat(skill-library): add test-generator skills batch 1 (page, route, component, client-state, model)"
```

---

### Task 10: Author Test-Generator skills — batch 2 (5 files)

**Files:** `skills/test-generators/gen-test-endpoint.md`, `gen-test-flow.md`, `gen-test-auth-boundary.md`, `gen-test-design-token.md`, `gen-test-dependency.md`

Each file follows the same shape as Task 9's generators — minimal frontmatter (`name`, `description`, `activate_on: "node:<kind>"`, optional `model_hint`), a "When to use" section, a "Checklist" section, optional "Anti-patterns". Key content per file:

- [ ] **Step 1: Write `skills/test-generators/gen-test-endpoint.md`**

````markdown
---
name: gen-test-endpoint
description: Generate request/response contract tests + auth + rate-limit tests for an Endpoint node
activate_on: "node:endpoint"
model_hint: sonnet
---

# Generate Test — Endpoint

## When to use

Auto-activated when an `Endpoint` node is added or its method/path/inputs/outputs/authBoundary/rateLimit change.

## Checklist

- [ ] Request-body test: valid payload returns 200 + matching outputs shape; invalid payload returns 400.
- [ ] Auth test: if AuthBoundary present, unauthed call returns 401; wrong-role call returns 403.
- [ ] Rate-limit test: (rateLimit+1) calls in the window return 429.
- [ ] PII+compliance test: if the Endpoint mutates a PII Model, confirm invariant I04 passes (endpoint has both AuthBoundary and ComplianceClass requires-edges).
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → Endpoint.
````

- [ ] **Step 2: Write `skills/test-generators/gen-test-flow.md`**

````markdown
---
name: gen-test-flow
description: Generate end-to-end Playwright tests for a Flow node (sequence of steps)
activate_on: "node:flow"
model_hint: sonnet
---

# Generate Test — Flow

## When to use

Auto-activated when a `Flow` node is added or its steps/failurePaths change.

## Checklist

- [ ] Happy-path test: walk every step in Flow.steps; assert the final state matches Flow.terminalState.
- [ ] Failure-path tests: for each Flow.failurePaths entry, trigger the failure + assert the recovery path runs.
- [ ] Coverage: confirm every step is observed at least once across the test set.
- [ ] Emit as Test node with `covers`-edge → Flow.
````

- [ ] **Step 3: Write `skills/test-generators/gen-test-auth-boundary.md`**

````markdown
---
name: gen-test-auth-boundary
description: Generate baseline security tests for an AuthBoundary node (required by I13)
activate_on: "node:authboundary"
model_hint: opus
---

# Generate Test — AuthBoundary

## When to use

Auto-activated when an `AuthBoundary` node is added. AuthBoundary test coverage is mandated by invariant I13 (`I13_PROTECTED_TARGET_MISSING_BASELINE_TEST`).

## Checklist

- [ ] Unauthed access returns 401 + correct redirect.
- [ ] Authed-but-wrong-role access returns 403.
- [ ] Role elevation after re-auth grants access (if roles support elevation).
- [ ] Session expiry returns 401 and re-auth flow.
- [ ] Emit as Test node with `source: "baseline"` (human-authored equivalent — the LLM cannot rewrite this) and `covers`-edge → AuthBoundary.

## Anti-patterns

- Do not emit baseline tests that depend on app-level role names — use the AuthBoundary's declared roles directly.
````

- [ ] **Step 4: Write `skills/test-generators/gen-test-design-token.md`**

````markdown
---
name: gen-test-design-token
description: Generate contrast + token-usage tests for a DesignToken node
activate_on: "node:designtoken"
model_hint: haiku
---

# Generate Test — DesignToken

## When to use

Auto-activated when a `DesignToken` node is added.

## Checklist

- [ ] Contrast test: if the token is a color pair (fg/bg), assert WCAG 2.2 AA contrast ratios.
- [ ] Usage test: confirm the token is referenced by at least one Component (else it's dead token).
- [ ] Theme-switch test: if the token has `lightValue` + `darkValue`, both pass contrast in their respective modes.
- [ ] Emit as Test node with `covers`-edge → DesignToken.
````

- [ ] **Step 5: Write `skills/test-generators/gen-test-dependency.md`**

````markdown
---
name: gen-test-dependency
description: Generate CVE + license + upgrade-path tests for a Dependency node
activate_on: "node:dependency"
model_hint: haiku
---

# Generate Test — Dependency

## When to use

Auto-activated when a `Dependency` node is added or its version changes.

## Checklist

- [ ] CVE test: query osv.dev / npm audit; fail on critical severity (I06).
- [ ] License test: fail on copyleft licenses (GPL, AGPL) unless the app itself is OSS + accepts.
- [ ] Version-range test: if the Dependency declares `supportedMajorRange`, confirm the current version is within it.
- [ ] Emit as Test node with `covers`-edge → Dependency.
````

- [ ] **Step 6: Commit**

```bash
git add packages/skill-library/skills/test-generators/gen-test-endpoint.md packages/skill-library/skills/test-generators/gen-test-flow.md packages/skill-library/skills/test-generators/gen-test-auth-boundary.md packages/skill-library/skills/test-generators/gen-test-design-token.md packages/skill-library/skills/test-generators/gen-test-dependency.md
git commit -m "feat(skill-library): add test-generator skills batch 2 (endpoint, flow, auth-boundary, design-token, dependency)"
```

---

### Task 11: Author Test-Generator skills — batch 3 (4 files)

**Files:** `skills/test-generators/gen-test-compliance-class.md`, `gen-test-ai-feature.md`, `gen-test-media-asset.md`, `gen-test-test.md`

- [ ] **Step 1: Write `skills/test-generators/gen-test-compliance-class.md`**

````markdown
---
name: gen-test-compliance-class
description: Generate baseline compliance-evidence tests for a ComplianceClass node (required by I13 for non-baseline)
activate_on: "node:compliance"
model_hint: opus
---

# Generate Test — ComplianceClass

## When to use

Auto-activated when a `ComplianceClass` node is added. Non-baseline ComplianceClasses require a `source: "baseline"` Test per I13.

## Checklist

- [ ] For each assertion in ComplianceClass.baselineAssertions, emit a concrete test that exercises it.
- [ ] HIPAA: audit-log presence, PHI field encryption at rest, BAA-traceable provider list.
- [ ] GDPR: data-subject-access-request endpoint returns user's data in 30 days, deletion endpoint scrubs across Models.
- [ ] DPDP-India: data-fiduciary consent-capture event for every PII-write.
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → ComplianceClass.

## Anti-patterns

- Do not auto-generate compliance assertions — they must be human-authored to be defensible.
````

- [ ] **Step 2: Write `skills/test-generators/gen-test-ai-feature.md`**

````markdown
---
name: gen-test-ai-feature
description: Generate personalization + privacy tests for an AIFeature node
activate_on: "node:aifeature"
model_hint: sonnet
---

# Generate Test — AIFeature

## When to use

Auto-activated when an `AIFeature` node is added or its personalization/inputModality/safetyContract changes.

## Checklist

- [ ] Personalization test: if personalized=true, verify ComplianceClass edge exists (I10).
- [ ] Input-modality test: every declared modality (text/image/audio/video) round-trips through the feature.
- [ ] Safety-contract test: inputs matching the contract's disallowed patterns are refused with the expected refusal message.
- [ ] Privacy-mode test: if privacyMode=`"on-device"`, no network call leaves the device during inference.
- [ ] Emit as Test node with `covers`-edge → AIFeature.
````

- [ ] **Step 3: Write `skills/test-generators/gen-test-media-asset.md`**

````markdown
---
name: gen-test-media-asset
description: Generate provider + license + size tests for a MediaAsset node
activate_on: "node:mediaasset"
model_hint: haiku
---

# Generate Test — MediaAsset

## When to use

Auto-activated when a `MediaAsset` node is added.

## Checklist

- [ ] Provider test: if MediaAsset.source=`"generated"`, confirm providerCapability is set (I11).
- [ ] License test: if source=`"stock"`, confirm licenseStatus is in the allowlist.
- [ ] Size test: image assets under 500KB; video under 10MB for v1 (adjust per Page's performance budget).
- [ ] Kind test: MediaAsset.kind ∈ `{image, icon, illustration}` in v1 (I14).
- [ ] Emit as Test node with `covers`-edge → MediaAsset.
````

- [ ] **Step 4: Write `skills/test-generators/gen-test-test.md`**

````markdown
---
name: gen-test-test
description: Meta — generate a sanity test for a Test node itself (it runs, it reports)
activate_on: "node:test"
model_hint: haiku
---

# Generate Test — Test

## When to use

Auto-activated when a `Test` node is added. This is a meta-generator: the Test node represents a test that exists in the test suite; this generator verifies the Test node itself is wired into CI.

## Checklist

- [ ] Discovery test: the Test node's file path exists in the repo.
- [ ] Execution test: running the test via `pnpm -F <package> test <path>` exits 0 (for passing tests) or non-zero (for a deliberately-failing baseline).
- [ ] Source-tag test: if Test.source=`"baseline"`, a matching entry exists in `.atlas/baselines.json` recording the human author + date.
- [ ] This is NOT emitted as a Test node (that would cause infinite recursion); it's a registry-level assertion.

## Anti-patterns

- Do not emit `covers`-edge — Tests test other nodes, not themselves.
````

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/skills/test-generators/gen-test-compliance-class.md packages/skill-library/skills/test-generators/gen-test-ai-feature.md packages/skill-library/skills/test-generators/gen-test-media-asset.md packages/skill-library/skills/test-generators/gen-test-test.md
git commit -m "feat(skill-library): add test-generator skills batch 3 (compliance, ai-feature, media-asset, test)"
```

---

### Task 12: Frontmatter validator script + TDD test

**Files:**
- Create: `packages/skill-library/scripts/validate-frontmatter.mjs`
- Create: `packages/skill-library/test/validate-frontmatter.test.mjs`

- [ ] **Step 1: Write the failing test**

`packages/skill-library/test/validate-frontmatter.test.mjs`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

test("validate-frontmatter exits 0 over the real skills/ tree", () => {
  const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
    cwd: pkgRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `validator failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /validated \d+ skills/);
});

test("validate-frontmatter exits non-zero when a skill has no frontmatter", async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "skill-lib-validator-"));
  mkdirSync(join(tmp, "skills", "test"), { recursive: true });
  writeFileSync(join(tmp, "skills", "test", "bad.md"), "# no frontmatter here\n", "utf8");
  try {
    const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
      cwd: pkgRoot,
      env: { ...process.env, SKILL_LIBRARY_ROOT: tmp },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /bad\.md/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validate-frontmatter rejects test-generators that omit activate_on", async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "skill-lib-validator-"));
  mkdirSync(join(tmp, "skills", "test-generators"), { recursive: true });
  writeFileSync(
    join(tmp, "skills", "test-generators", "gen-test-missing-activate.md"),
    `---
name: gen-test-missing-activate
description: bad — test generators must carry activate_on
---

# body
`,
    "utf8"
  );
  try {
    const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
      cwd: pkgRoot,
      env: { ...process.env, SKILL_LIBRARY_ROOT: tmp },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /activate_on/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd packages/skill-library
pnpm test
```

Expected: all three tests fail because the script doesn't exist yet.

- [ ] **Step 3: Write the validator**

`packages/skill-library/scripts/validate-frontmatter.mjs`:

```javascript
#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, validateFrontmatter } from "@atlas/skill-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const rootOverride = process.env.SKILL_LIBRARY_ROOT;
const libraryRoot = rootOverride ?? pkgRoot;
const skillsRoot = join(libraryRoot, "skills");

function collectMarkdown(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectMarkdown(full));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = collectMarkdown(skillsRoot);
if (files.length === 0) {
  process.stderr.write(`no .md files found under ${skillsRoot}\n`);
  process.exit(1);
}

const errors = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  let body, fm;
  try {
    const parsed = parseFrontmatter(raw);
    body = parsed.body;
    fm = validateFrontmatter(parsed.frontmatter);
  } catch (err) {
    errors.push({ file, message: (err instanceof Error ? err.message : String(err)) });
    continue;
  }
  const rel = relative(libraryRoot, file);
  const segments = rel.split(sep);
  const isTestGenerator = segments.includes("test-generators");
  if (isTestGenerator && !fm.activate_on) {
    errors.push({ file, message: "test-generators must declare activate_on" });
  }
}

if (errors.length > 0) {
  for (const e of errors) {
    process.stderr.write(`FAIL ${e.file}: ${e.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`validated ${files.length} skills\n`);
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd packages/skill-library
pnpm test
```

Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-library/scripts/ packages/skill-library/test/
git commit -m "feat(skill-library): frontmatter validator script + TDD tests"
```

---

### Task 13: Root `pnpm validate:skills` script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the root script**

Edit the root `package.json` scripts block. Add:

```
    "validate:skills": "pnpm -F @atlas/skill-library validate"
```

after the existing `py:test` entry, preserving trailing comma where appropriate.

- [ ] **Step 2: Verify**

```bash
pnpm run validate:skills
```

Expected: stdout ends with `validated 39 skills` (or whatever the current count is). Exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(monorepo): add validate:skills root script wiring @atlas/skill-library"
```

---

### Task 14: `skill-library-ci.yml` — validate frontmatter on every PR

**Files:**
- Create: `.github/workflows/skill-library-ci.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/skill-library-ci.yml`:

```yaml
name: skill-library-ci

on:
  pull_request:
    paths:
      - "packages/skill-library/**"
      - "packages/skill-runtime/**"
      - ".github/workflows/skill-library-ci.yml"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -F @atlas/skill-runtime build
      - run: pnpm -F @atlas/skill-library validate
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/skill-library-ci.yml
git commit -m "ci(skill-library): validate frontmatter on every PR"
```

No local test for this task — the workflow triggers only on actual PRs. Post-merge, open a PR that intentionally breaks a skill's frontmatter to confirm the workflow catches it.

---

### Task 15: `skill-library-release.yml` — tag-push mirror workflow

**Files:**
- Create: `.github/workflows/skill-library-release.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/skill-library-release.yml`:

```yaml
name: skill-library-release

# Release cadence (Unit C OQ4):
# - Weekly patch release: tag vX.Y.Z every Monday
# - Monthly minor release: tag vX.(Y+1).0 on the first of each month

on:
  push:
    tags:
      - "skill-library-v*"

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build tarball
        run: |
          cd packages/skill-library
          tar -czf ../../skill-library-${GITHUB_REF_NAME}.tar.gz skills/ LICENSE README.md
      - name: Upload release artifact
        uses: actions/upload-artifact@v4
        with:
          name: skill-library-tarball
          path: skill-library-*.tar.gz
      # The actual push to github.com/atlas-labs/atlas-skills is a MANUAL step for v1
      # until the public repo is created. Once the public repo exists, add a step here:
      #
      #   - name: Push to public repo
      #     env:
      #       PUBLIC_REPO_TOKEN: ${{ secrets.ATLAS_SKILLS_PUBLIC_PUSH }}
      #     run: |
      #       git clone https://x:${PUBLIC_REPO_TOKEN}@github.com/atlas-labs/atlas-skills public
      #       rsync -a --delete packages/skill-library/skills/ public/skills/
      #       cp packages/skill-library/LICENSE public/LICENSE
      #       cp packages/skill-library/README.md public/README.md
      #       cd public
      #       git add -A
      #       git commit -m "mirror: ${GITHUB_REF_NAME}"
      #       git tag ${GITHUB_REF_NAME}
      #       git push origin main --tags
      - name: Remind to push to public repo
        run: |
          echo "::notice::Tarball built. Manual step: clone github.com/atlas-labs/atlas-skills, copy skills/ + LICENSE + README, commit + tag + push."
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/skill-library-release.yml
git commit -m "ci(skill-library): tag-push release workflow (manual public-repo mirror for v1)"
```

---

### Task 16: Wire bundled-library discovery into `@atlas/skill-runtime.loadBundledSkills()`

**Files:**
- Modify: `packages/skill-runtime/src/helpers.ts`
- Create: `packages/skill-runtime/test/bundled-library.test.ts`

The C.1 ship of `loadBundledSkills` was a stub that returned an empty array. Replace it with a real implementation that resolves the monorepo-root-relative path `packages/skill-library/skills/` and uses `loadSkillsFromDir` to read every group's skills.

- [ ] **Step 1: Write the failing test**

`packages/skill-runtime/test/bundled-library.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadBundledSkills } from "../src/helpers.js";

describe("loadBundledSkills (post-C.2)", () => {
  it("returns at least 39 skills from the bundled library", () => {
    const skills = loadBundledSkills();
    expect(skills.length).toBeGreaterThanOrEqual(39);
  });

  it("includes the canonical Architect skills", () => {
    const skills = loadBundledSkills();
    const names = new Set(skills.map((s) => s.frontmatter.name));
    for (const expected of ["brainstorm", "spec-graph", "runnable-plan", "visualize-diff", "approve-or-reject"]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("includes every test-generator with a node:<kind> activate_on pattern", () => {
    const skills = loadBundledSkills();
    const testGens = skills.filter((s) => s.frontmatter.name.startsWith("gen-test-"));
    expect(testGens.length).toBeGreaterThanOrEqual(14);
    for (const skill of testGens) {
      expect(skill.frontmatter.activate_on).toMatch(/^node:/);
    }
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm -F @atlas/skill-runtime test bundled-library
```

Expected: test fails because `loadBundledSkills` still returns the C.1 stub (likely an empty array or throws).

- [ ] **Step 3: Update `helpers.ts`**

Find the existing `loadBundledSkills` export in `packages/skill-runtime/src/helpers.ts`. Replace its body with:

```typescript
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "./loader.js";
import type { Skill } from "./skill.js";

// Resolves the bundled skill-library path relative to this file's location in node_modules.
// In dev monorepo mode (pnpm workspace), node_modules/@atlas/skill-runtime/dist/ → repo root → packages/skill-library/skills.
function resolveBundledSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find a directory containing `packages/skill-library/skills/`.
  let cursor = here;
  for (let i = 0; i < 10; i++) {
    const candidate = join(cursor, "packages", "skill-library", "skills");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Could not locate packages/skill-library/skills/ from ${here}`);
}

export function loadBundledSkills(): Skill[] {
  const root = resolveBundledSkillsRoot();
  const groups = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name));
  const out: Skill[] = [];
  for (const group of groups) {
    out.push(...loadSkillsFromDir(group));
  }
  return out;
}
```

Keep `createRegistryFromBundledLibrary` untouched — it already composes `loadBundledSkills`.

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm -F @atlas/skill-runtime build
pnpm -F @atlas/skill-runtime test bundled-library
```

Expected: 3 tests pass.

- [ ] **Step 5: Verify no other skill-runtime tests regressed**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: the previous 63 tests still green + 3 new bundled-library tests green (66 total, give or take).

- [ ] **Step 6: Commit**

```bash
git add packages/skill-runtime/src/helpers.ts packages/skill-runtime/test/bundled-library.test.ts
git commit -m "feat(skill-runtime): resolve loadBundledSkills against packages/skill-library/skills/"
```

---

### Task 17: Package README

**Files:**
- Create: `packages/skill-library/README.md`

- [ ] **Step 1: Write the README**

````markdown
# @atlas/skill-library

Atlas's starter skill library — ~39 OSS skills (Apache 2.0) authored by the Atlas team.

Skills are markdown files with YAML frontmatter, loaded at runtime by `@atlas/skill-runtime`. They describe **how** a role should handle a task, not implementation details. Skills auto-activate based on user intent (no slash commands for non-power users), compose cleanly, and are user-extensible.

## What's in the library

| Group | Count | Purpose |
|---|---|---|
| `architect/` | 5 | Brainstorm, spec-graph, runnable-plan, visualize-diff, approve-or-reject |
| `developer/` | 4 | TDD-feature, edit-only-what-changed, refactor, upgrade-dep |
| `debugger/` | 2 | Four-phase debug, incident response |
| `security/` | 4 | Audit RLS, CORS, secrets scan, CVE check |
| `accessibility/` | 4 | WCAG audit, RTL layout, keyboard nav, contrast check |
| `reviewer/` | 3 | Reviewer critique, PR summary, release notes |
| `ship/` | 4 | Domain/DNS/TLS, auth wire, payments wire, ship with rollback |
| `test-generators/` | 14 | One per node kind (page, route, component, client-state, model, endpoint, flow, auth-boundary, compliance, ai-feature, media-asset, design-token, dependency, test) |

## How to author a new skill

1. Pick the right group directory.
2. Create a `kebab-case.md` file. The filename stem must match the `name` field in frontmatter.
3. Populate the frontmatter:

```yaml
---
name: kebab-case
description: One-line summary ≤140 chars
activate_on: "some-intent-tag-or-pattern"   # recommended for most; required for test-generators
composes: ["other-skill-name"]              # optional
model_hint: "haiku" | "sonnet" | "opus"      # optional
---
```

4. Write the body: `# Title`, `## When to use`, `## Checklist`, optional `## Examples`, optional `## Anti-patterns`. Target 30-80 lines.
5. Run `pnpm -F @atlas/skill-library validate` to confirm the frontmatter parses and the file passes schema validation.

## Version pinning

Projects that want reproducible skill behaviour should commit `.atlas/skills/pin.json` (see `@atlas/skill-runtime`'s README for the schema). Weekly updates to the library may add or refine skills; the pin file fences a project to a known-good set.

## Release cadence

- **Weekly patch**: every Monday, auto-tagged `skill-library-vX.Y.Z+1` if any non-breaking change landed.
- **Monthly minor**: first of each month, `skill-library-vX.(Y+1).0`.
- **Breaking changes (major)**: batched quarterly, with a migration note in release notes.

The release workflow (`.github/workflows/skill-library-release.yml`) builds a tarball on tag push; the actual mirror to `github.com/atlas-labs/atlas-skills` is a manual step for v1 until the public repo is provisioned.

## License

Apache 2.0 — see `LICENSE`. Community contributions welcome via the public repo once live.
````

- [ ] **Step 2: Commit**

```bash
git add packages/skill-library/README.md
git commit -m "docs(skill-library): README — library contents, authoring guide, pin conventions"
```

---

### Task 18: Update plans README + handoff to C.3

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add a row for C.2**

Insert a new row in the Plan index table immediately after the C.1 row (row 7). New row 8 reads:

```
| 8 | `2026-04-20-skill-library.md` | **C.2 — Starter Skill Library + OSS pipeline** | ~39 markdown skills grouped by role; frontmatter validator + CI; tag-push release workflow; real `loadBundledSkills()` | 18 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber existing rows 8→9 (D.1), 9→10 (phase-a-units directional), 10→11 (phases-b-through-f-roadmap). Adjust cross-references in the execution-order diagram (e.g., `Plans[8]` → `Plans[9]` for D.1) accordingly.

Also in the ASCII execution-order diagram under `### Phase A — immediate`, refine the C.1 subtree so C.2 is visible:

```
            ├─ C.1 (Plans[7], shipped) — Skill Runtime
            │    └─ C.2 (Plans[8], shipped) — Starter Skill Library
            │         └─ C.3 — Test-Generator Registry (after C.2)
            └─ D.1 (Plans[9], shipped) — Conductor + LLM Provider
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add C.2 skill-library to plan index + refresh execution order"
```

---

## Completion Checklist

After all 18 tasks:

- [ ] `pnpm -F @atlas/skill-library validate` — exits 0, reports `validated 39 skills`
- [ ] `pnpm -F @atlas/skill-library test` — all 3 validator tests pass
- [ ] `pnpm -F @atlas/skill-runtime test` — the 66 tests (63 pre-C.2 + 3 bundled-library) all pass
- [ ] `pnpm -r test` — no regressions across workspace packages
- [ ] Every skill has valid frontmatter (name + description; activate_on for test-generators)
- [ ] `loadBundledSkills()` returns ≥ 39 Skill objects when called from within the monorepo
- [ ] `.github/workflows/skill-library-ci.yml` runs on every PR touching the library
- [ ] `.github/workflows/skill-library-release.yml` runs on `skill-library-v*` tag push
- [ ] `packages/skill-library/README.md` documents authoring, pinning, release cadence
- [ ] Plans README row 8 lists C.2 as shipped; execution-order diagram updated

## Handoff to C.3

C.3 (Test-Generator Registry + Human Baseline Infrastructure) consumes:

- Every `skills/test-generators/gen-test-<kind>.md` loaded by `loadBundledSkills()`.
- The `SkillRegistry.match(intent)` path — given a graph-mutation intent like `"node:page:added"`, the classifier routes to the matching test-generator skill.
- A new `packages/test-generator-registry/` (introduced by C.3) that wraps the 14 generators with: per-node-type dispatch, human-baseline-assertion co-location (`baselines/<kind>.md` files the LLM cannot rewrite per PRD §10.1), and drift detection against a calibration dataset.

C.3 does NOT modify C.2's skill files directly. New test-generator skills (e.g., for Phase-B infra nodes) land here as additive library entries; C.3 picks them up via the registry.
