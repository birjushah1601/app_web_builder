---
name: plan-cutover-decommission
description: Plan the verify, cutover, and decommission stages — promote target to system-of-record then retire source
activate_on: "role.migration-planner"
model_hint: opus
---

# Plan Cutover + Decommission (covers stages 3, 4, 5)

## When to use

Stages 3 (verify), 4 (cutover), 5 (decommission). Composes the plan for the back half of the migration.

## Stage 3 — verify

- [ ] Run a 24-hour observation window after 100% traffic is on target. No regressions, no anomalies.
- [ ] Reconcile source vs target writes: every write that hit source during traffic shift must be present on target (replication catch-up confirmed).
- [ ] Run the full L4 + L5 + L3 gate suite on the target's now-live state.
- [ ] Run a disaster-recovery drill: simulate target region failure, confirm failover plan works.

**Success criteria:** zero divergence findings, all gates pass, DR drill succeeds.

## Stage 4 — cutover

- [ ] Promote target to system-of-record. Source becomes read-only (replication direction reverses or stops).
- [ ] Update DNS/IAM/secrets so the application name resolves to target permanently.
- [ ] Update billing routing so spend telemetry flows to the target's `sandbox_spend_log`.
- [ ] Communicate cutover-complete to all stakeholders.

**Success criteria:** Source has zero writes for 24 hours post-cutover. All telemetry confirms target as primary.

**Rollback procedure:** within the first 24 hours after cutover, can roll back by reversing the promotion (source becomes primary again, write log on source replays into target). After 24 hours, rollback requires a fresh migration plan in the reverse direction.

## Stage 5 — decommission

- [ ] After 7 days of stable cutover, snapshot source for archival (compliance evidence).
- [ ] Tear down source provisioning. Cancel source subscriptions / instance reservations.
- [ ] Update spec-graph: remove source `WorkloadTopology` node OR mark it `decommissioned: true`. Add a `migratesTo` edge from source → target if not already present.
- [ ] Final spend report compares forecasted savings vs actual.

**Success criteria:** Source resources fully torn down, archival snapshot stored, spec-graph reflects new topology, forecasted-vs-actual report published.

## Anti-patterns

- Do not decommission source within the same week as cutover. The 7-day buffer catches latent issues.
- Do not skip the archival snapshot — compliance audits often require evidence of pre-cutover state.
