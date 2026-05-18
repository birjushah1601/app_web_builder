---
name: assess-target-topology
description: Inventory the target WorkloadTopology and validate it can host every workload from the source
activate_on: "role.migration-planner"
model_hint: opus
---

# Assess Target Topology

## When to use

Second step. Runs after `assess-source-topology` so we have the source inventory to compare against.

## Checklist

- [ ] Resolve the target WorkloadTopology node and list its providers + regions.
- [ ] For every Runtime in the source, confirm the target supports the same language + a compatible version. Flag versions that require a workload upgrade.
- [ ] For every PII Model in the source, confirm the target Region's jurisdiction satisfies the Model's residency constraints (cross-check via `storesDataIn` and `jurisdictionRef`).
- [ ] For every external `dependsOn`, confirm the target environment can reach the dependency (network egress, IAM, peering).
- [ ] Estimate target capacity vs source utilization. Flag if target is under-provisioned.
- [ ] Cross-check that the `migratesTo` edge exists between source and target (I-validators handle the actual graph integrity check).

## Output to incorporate into plan

Add to `prerequisites`: a per-Runtime, per-PII-Model, per-Dependency confirmation that the target satisfies the constraint. Add to `risks` of the dual-run stage: any constraint that requires a workload upgrade (those upgrades happen during dual-run, not at cutover).

## Anti-patterns

- Do not accept "we'll resize after cutover" — capacity must be verified before stage 1.
- Do not ignore residency mismatches even if the project hasn't declared a ComplianceClass. Residency violations are silent until they become legal incidents.
