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
