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
