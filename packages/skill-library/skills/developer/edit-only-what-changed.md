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
