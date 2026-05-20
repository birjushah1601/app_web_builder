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
