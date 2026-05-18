---
name: plan-dual-run
description: Plan the dual-run stage — source and target serve traffic in parallel, target is shadow-tested
activate_on: "role.migration-planner"
model_hint: opus
---

# Plan Dual-Run

## When to use

Stage 1 of every migration. The target environment is fully provisioned and receives mirror traffic, but the source remains the system of record.

## Checklist

- [ ] Provision the full target topology (every workload, every Model, every external dependency wired).
- [ ] Set up data replication source → target (logical replication for relational DBs, change-data-capture for event stores). Replication lag must be observable.
- [ ] Mirror a fraction of read traffic (start with 1%, ramp to 10%) to the target. Compare responses; log divergences.
- [ ] Mirror writes to a parallel write log on the target — do NOT let target writes affect source state. The point is to validate target behavior, not switch.
- [ ] Run the L4/L5 merge gates against the target topology (security, accessibility, browser-verification all pass).
- [ ] Verify residency constraints actively (e.g., make a request from EU origin, confirm PII Model writes land in EU Region).

## Success criteria

- Target serves shadow traffic with < 1% divergence from source over 7 consecutive days.
- Replication lag P95 < 5 seconds.
- Zero failed L4/L5 gate runs against the target.
- All residency assertions pass via active verification.

## Rollback procedure

Tear down target, stop replication, no source impact. Cost: provisioning hours + replication bandwidth. No data integrity risk because target is read-only from the user perspective.

## Risks

- Replication lag becomes the new SLA constraint at cutover. Set the dual-run replication tolerance to the value you want at cutover.
- "Target is up but slow" hides until traffic shift. Use synthetic load + soak.
