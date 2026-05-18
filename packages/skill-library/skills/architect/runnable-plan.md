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
