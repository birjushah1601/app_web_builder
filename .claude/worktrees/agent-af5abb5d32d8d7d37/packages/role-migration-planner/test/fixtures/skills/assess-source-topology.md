---
name: assess-source-topology
description: Inventory the source WorkloadTopology — providers, regions, runtimes, residency constraints, dependencies
activate_on: "role.migration-planner"
model_hint: opus
---

# Assess Source Topology

## When to use

First step of every migration plan. Before any stage is drafted, the source topology must be fully inventoried.

## Checklist

- [ ] Resolve the source WorkloadTopology node and list every Provider it references via `providerRefs`.
- [ ] List every Region it references via `regionRefs` and note each Region's `cloudProviderRef` and `jurisdictionRef`.
- [ ] List every Runtime referenced by Components/Endpoints via `runsOn` edges. Note language + version.
- [ ] List every Model with `piiClassification !== "none"` and its `storesDataIn` edges. These define hard residency constraints.
- [ ] List every external `dependsOn` (managed services, third-party APIs) — these may need separate migration tracks.
- [ ] Note the source topology shape (single-region, active-passive, etc.) — the migration approach differs by shape.

## Output to incorporate into plan

A summary block in the `prerequisites` array that names every component the migration touches, so the operator can confirm the inventory before stage 1 begins.

## Anti-patterns

- Do not assume source = a single AWS region. Real production topologies are messy.
- Do not skip the `dependsOn` walk — third-party APIs that aren't migrated cause silent failures post-cutover.
