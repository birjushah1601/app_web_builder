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
