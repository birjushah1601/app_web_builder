---
name: plan-traffic-shift
description: Plan the traffic-shift stage — gradual percentage cutover with verify gates between each step
activate_on: "role.migration-planner"
model_hint: opus
---

# Plan Traffic Shift

## When to use

Stage 2 of every migration. Real user traffic begins to land on the target. Each shift is followed by a `verify` substep before the next ramp.

## Checklist

- [ ] Define the shift schedule. Conservative default: 5% → 25% → 50% → 75% → 100%, with 60 minutes of soak between each step.
- [ ] At every step, capture per-tier latency (P50/P95/P99), error rate, and saturation metrics from BOTH source and target. Compare side-by-side.
- [ ] Per-step soak: any of the following triggers an automatic rollback to the previous percentage:
  - Target P95 latency > 1.5× source P95
  - Target error rate > 1.5× source error rate
  - Replication lag exceeds dual-run tolerance
  - Any L4/L5 gate fails
- [ ] Hold flat at any percentage if a regression is suspected; do not advance until the suspicion is resolved.
- [ ] Communicate each shift step to on-call channel BEFORE the shift, not after.

## Success criteria

- Reach 100% target traffic with no SLO breach during any soak window.
- Source remains warm and ready for instant rollback through this entire stage.

## Rollback procedure

DNS / load-balancer policy reverts to source-only routing. Replication continues so writes that landed during target traffic stay synced back to source. Within ≤ 5 minutes of decision-to-rollback, all traffic is back on source.

## Risks

- Cache cold-start on target during ramp. Pre-warm caches before each step.
- Sticky sessions may force users to reconnect. Confirm session affinity policy survives the load-balancer change.
