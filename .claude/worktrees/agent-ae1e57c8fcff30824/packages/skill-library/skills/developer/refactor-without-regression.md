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
