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
