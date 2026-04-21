# Accessibility Role (L5 Merge Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/role-accessibility/` — the fourth concrete `Role` implementation, mirroring D.4's Security-role structure but for the L5 **accessibility** merge gate. Composes four a11y skills from `@atlas/skill-library` (`wcag-audit`, `rtl-layout`, `keyboard-nav`, `contrast-check`). Implements both `Role` (from `@atlas/conductor`) and `GateRunner` (from `@atlas/gate-scheduler`, `layer: "L5"`).

**Architecture:** Single pnpm-workspace package. Single-provider dispatch via **Sonnet 4.6** (per PRD §11.3 — a11y findings are structured checklist items, not adversarial security rulings). Same dual-interface pattern as D.4. Output shape: `AccessibilityReport { passed, issues[], skillsRun[] }` where each issue carries `{ severity, code (A11Y-<skill>-<n>), message, file?, line? }`. The severity→passed rule: `any issue with severity "critical" forces passed=false`. `RoleOutput.diff = { kind: "none" }` (validates, doesn't generate).

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS. Workspace deps: `@atlas/conductor`, `@atlas/gate-scheduler`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`. No new external runtime deps in v1 (a real `axe-core` integration path is documented but deferred to a follow-up — the LLM-driven skill composition is the v1 surface).

**Prerequisites:** D.1 + D.2 + C.1 + G.1 + D.4 merged.

---

## File Structure

Mirror of `packages/role-security/`:

```
packages/role-accessibility/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts
    types.ts                                  # AccessibilityReport, AccessibilityIssue Zod
    assemble-prompt.ts                        # composes 4 a11y skills
    accessibility-check.ts                    # runAccessibilityCheck() — Sonnet pass
    role.ts                                   # AccessibilityRole implements Role
    gate-runner.ts                            # AccessibilityGateRunner implements GateRunner { layer: "L5" }
    errors.ts
  test/
    types.test.ts
    assemble-prompt.test.ts
    accessibility-check.test.ts
    role-passed.test.ts
    role-failed.test.ts
    gate-runner-passed.test.ts
    gate-runner-failed.test.ts
    conductor-fit.test.ts
    observability.test.ts
    fixtures/skills/                          # wcag-audit, rtl-layout, keyboard-nav, contrast-check fixtures

docs/superpowers/plans/
  README.md                                   # MODIFIED — add D.5 entry
```

## Open-question resolutions

- **Sonnet 4.6 (not Opus).** PRD §11.3 assigns Sonnet to Accessibility. A11y findings are mostly rule-book lookups + pattern checks — the failure modes are better understood than security, and cost sensitivity is higher because a11y checks run more frequently (per page, per component).
- **axe-core integration deferred to a follow-up.** The plan ships LLM-driven skill composition as v1. A future `D.5-axe-integration` micro-plan wires real axe-core runs in the E2B sandbox and folds results into `AccessibilityReport.issues`. The `AccessibilityReport` shape already supports the axe-core data model (file, line, message, code).
- **Severity code prefix.** `A11Y-<skill>-<n>` (e.g., `A11Y-WCAG-004`, `A11Y-RTL-001`, `A11Y-KB-007`, `A11Y-CON-002`). Not `SEC-` (that's D.4).
- **Critical severity.** Any WCAG 2.2 **AA-failing** issue is `critical`. AAA-failing issues are `high`. Minor visual issues are `medium`. Nice-to-haves are `low`. The L5 gate blocks only on `critical`.

---

## Task list

This plan is **structurally identical to D.4** (13 tasks). Rename → swap → retest:

### Task 1: Scaffold `packages/role-accessibility/`

Copy `packages/role-security/{package.json, tsconfig.json, vitest.config.ts}` into `packages/role-accessibility/`. In `package.json`, change `"name": "@atlas/role-accessibility"`. Keep the dependency list identical. Placeholder `src/index.ts` = `export {};`.

```bash
mkdir -p packages/role-accessibility/src packages/role-accessibility/test/fixtures/skills
# write package.json, tsconfig.json, vitest.config.ts (copy-paste from role-security; change name only)
# write src/index.ts placeholder
pnpm install && pnpm -F @atlas/role-accessibility typecheck
git add packages/role-accessibility/ pnpm-lock.yaml
git commit -m "feat(role-accessibility): scaffold package mirroring role-security structure"
```

---

### Task 2: `AccessibilityIssue` + `AccessibilityReport` Zod types

**Files:** `src/types.ts` + `test/types.test.ts`.

Mirror D.4's `types.ts` but:
- Swap severity `code` regex from `/^SEC-/` to `/^A11Y-/`.
- Rename exports: `SecurityReport` → `AccessibilityReport`, `SecurityIssue` → `AccessibilityIssue`, `SecurityInvocation` → `AccessibilityInvocation`.
- Keep the `critical → passed=false` superRefine constraint.

Write a test file mirroring D.4's `types.test.ts` but using `A11Y-WCAG-004`-style codes.

```bash
pnpm -F @atlas/role-accessibility test types
git add packages/role-accessibility/src/types.ts packages/role-accessibility/test/types.test.ts
git commit -m "feat(role-accessibility): AccessibilityReport + AccessibilityIssue Zod (A11Y- code prefix)"
```

---

### Task 3: `assembleAccessibilityPrompt()` + 4 fixture skills + `errors.ts`

**Files:** `src/assemble-prompt.ts`, `src/errors.ts`, `test/assemble-prompt.test.ts`, `test/fixtures/skills/{wcag-audit,rtl-layout,keyboard-nav,contrast-check}.md`.

Mirror D.4's `assemble-prompt.ts` verbatim, renaming the function to `assembleAccessibilityPrompt` and the hard-coded canonical skill list to `["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]`. `errors.ts` has `AccessibilityRoleError`, `SkillMissingError`, `AccessibilityCheckFailedError`.

Author 4 fixture skills (~10 lines each) with valid frontmatter. Test asserts all 4 names resolve + `SkillMissingError` when one is absent.

```bash
pnpm -F @atlas/role-accessibility test assemble-prompt
git add packages/role-accessibility/src/assemble-prompt.ts packages/role-accessibility/src/errors.ts packages/role-accessibility/test/assemble-prompt.test.ts packages/role-accessibility/test/fixtures/
git commit -m "feat(role-accessibility): assembleAccessibilityPrompt + 4 fixture skills + error hierarchy"
```

---

### Task 4: `runAccessibilityCheck()` — Sonnet 4.6 pass via tool-use

**Files:** `src/accessibility-check.ts` + `test/accessibility-check.test.ts`.

Mirror D.4's `security-check.ts` exactly, with these substitutions:

| D.4 → D.5 |
|---|
| `SECURITY_MODEL = "claude-opus-4-7"` → `ACCESSIBILITY_MODEL = "claude-sonnet-4-6"` |
| `emit_security_report` → `emit_accessibility_report` |
| `SecurityReportSchema` → `AccessibilityReportSchema` |
| `SecurityCheckFailedError` → `AccessibilityCheckFailedError` |
| System-prompt sentence "You are the Atlas L4 Security gate" → "You are the Atlas L5 Accessibility gate" |
| 4 skill names: `audit-rls/cors-policy/secrets-scan/cve-check` → `wcag-audit/rtl-layout/keyboard-nav/contrast-check` |

Two tests (mirror D.4's): passed-path + failed-path.

```bash
pnpm -F @atlas/role-accessibility test accessibility-check
git add packages/role-accessibility/src/accessibility-check.ts packages/role-accessibility/test/accessibility-check.test.ts
git commit -m "feat(role-accessibility): runAccessibilityCheck via Sonnet 4.6 + tool-use emit_accessibility_report"
```

---

### Task 5: `AccessibilityRole.run()` — Role interface (passed path)

**Files:** `src/role.ts` + `src/index.ts` + `test/role-passed.test.ts`.

Mirror D.4's `role.ts` with these renames:
- Class name `SecurityRole` → `AccessibilityRole`
- `id = "security"` → `id = "accessibility"`
- Event prefixes: `security.started` → `accessibility.started` (same for `.passed`, `.failed`, `.completed`, `.errored`)
- Constructor type `SecurityRoleOptions` → `AccessibilityRoleOptions`

Test: mirror D.4's `role-passed.test.ts`.

```bash
pnpm -F @atlas/role-accessibility test role-passed
git add packages/role-accessibility/src/role.ts packages/role-accessibility/src/index.ts packages/role-accessibility/test/role-passed.test.ts
git commit -m "feat(role-accessibility): AccessibilityRole implementing Role interface (passed path)"
```

---

### Task 6: Role failed-path test

**Files:** `test/role-failed.test.ts`. Mirror D.4's.

```bash
pnpm -F @atlas/role-accessibility test role-failed
git add packages/role-accessibility/test/role-failed.test.ts
git commit -m "test(role-accessibility): failed path emits accessibility.failed with critical count"
```

---

### Task 7: `AccessibilityGateRunner` — GateRunner interface (passed path)

**Files:** `src/gate-runner.ts` + `test/gate-runner-passed.test.ts`.

Mirror D.4's `gate-runner.ts` with:
- Class name `SecurityGateRunner` → `AccessibilityGateRunner`
- `layer: "L4"` → `layer: "L5"`
- Summary strings: `L4 passed` → `L5 passed` etc.

Test: mirror D.4's gate-runner-passed test.

```bash
pnpm -F @atlas/role-accessibility test gate-runner-passed
git add packages/role-accessibility/src/gate-runner.ts packages/role-accessibility/test/gate-runner-passed.test.ts
git commit -m "feat(role-accessibility): AccessibilityGateRunner implementing @atlas/gate-scheduler.GateRunner (L5)"
```

---

### Task 8: GateRunner failed-path test

**Files:** `test/gate-runner-failed.test.ts`. Mirror D.4's.

```bash
pnpm -F @atlas/role-accessibility test gate-runner-failed
git add packages/role-accessibility/test/gate-runner-failed.test.ts
git commit -m "test(role-accessibility): gate-runner failed path maps critical issues to GateResult"
```

---

### Task 9: Conductor-fit test

**Files:** `test/conductor-fit.test.ts`. Mirror D.4's, registering `AccessibilityRole` under `roleId: "accessibility"`.

```bash
pnpm -F @atlas/role-accessibility test conductor-fit
git add packages/role-accessibility/test/conductor-fit.test.ts
git commit -m "test(role-accessibility): satisfies @atlas/conductor.Role under Conductor.dispatch"
```

---

### Task 10: Observability test

**Files:** `test/observability.test.ts`. Mirror D.4's, asserting `claude-sonnet-4-6` as the labelled model (not `claude-opus-4-7`).

```bash
pnpm -F @atlas/role-accessibility test observability
git add packages/role-accessibility/test/observability.test.ts
git commit -m "test(role-accessibility): Sonnet call emits labelled Prometheus metrics"
```

---

### Task 11: Build + workspace smoke

```bash
pnpm -F @atlas/role-accessibility build && pnpm -F @atlas/role-accessibility typecheck && pnpm -F @atlas/role-accessibility test
pnpm -r test
git commit --allow-empty -m "chore(role-accessibility): full-suite smoke green post D.5"
```

---

### Task 12: README

**Files:** `packages/role-accessibility/README.md`.

Adapt D.4's README: dual-interface (Role + GateRunner), Sonnet 4.6 usage, 4 composed skills, AccessibilityReport shape, `passed: false` iff any WCAG-AA-failing issue, G.1 scheduler L5 integration, axe-core follow-up note.

```bash
git add packages/role-accessibility/README.md
git commit -m "docs(role-accessibility): README — dual-interface, Sonnet, 4 skills, WCAG-AA critical threshold, axe-core deferred"
```

---

### Task 13: Plan index update

Insert D.5 row in `docs/superpowers/plans/README.md` after D.4 row. Set status `Shipped (pending merge — TODO: update SHA post-merge)`. Add `[x] D.5 — Accessibility role (L5 merge gate) (pending merge)` to Phase A exit checklist.

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add D.5 role-accessibility to plan index + exit checklist"
```

---

## Completion Checklist

After all 13 tasks:

- [ ] `pnpm -F @atlas/role-accessibility test` — all green (~11 tests across 9 files)
- [ ] `AccessibilityRole` implements `Role`; `AccessibilityGateRunner` implements `GateRunner { layer: "L5" }`
- [ ] Both interfaces share the same `runAccessibilityCheck` underneath
- [ ] `passed: false` iff any issue's `severity === "critical"` (WCAG-AA failing)
- [ ] No cross-package regressions (pre-existing Postgres flakiness acceptable)
- [ ] Plan index lists D.5 as shipped (pending merge)

## Handoff

With D.5 merged:

- **Conductor has 4 concrete role implementations**: Architect (D.2), Developer (D.3), Security (D.4), Accessibility (D.5).
- **Gate scheduler has 2 concrete gate runners**: L4 Security (D.4), L5 Accessibility (D.5). L1 (schema invariants from B.1), L2 (type-check/lint), L3 (Browser Verification — Phase B) remain scheduler-only; L6 + L7 are advisory.
- **PRD §11.3 role-matrix status after D.5**: 4 of 13 roles shipped. Remaining: Designer, Schema, Browser Verification, Debugger, Refactor, Upgrade, Reviewer (stand-alone), Validator, Ship. Some of these (Reviewer) are already functions inside D.3; others (Designer, Debugger, Refactor, Upgrade) are Phase B work.

Next recommended plan: **C.3 — Test-Generator Registry + Human Baselines** — wires the 14 `gen-test-*` skills into per-node-kind dispatch so D.3's Developer role can auto-invoke the right test generator on graph mutations.
