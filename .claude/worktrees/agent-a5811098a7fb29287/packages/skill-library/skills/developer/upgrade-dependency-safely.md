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
