---
name: ship-with-rollback
description: Deploy with a one-click armed rollback; health-check + auto-revert on red
activate_on: "ship"
model_hint: sonnet
---

# Ship With Rollback

## When to use

Every Ship-scope task.

## Checklist

- [ ] Pre-deploy: snapshot the current prod version (tag + container digest).
- [ ] Deploy to a canary / preview environment first.
- [ ] Run post-deploy health checks (HTTP 200 on /, critical route latency < baseline × 2, error rate < baseline × 1.5).
- [ ] Arm a one-click rollback: revert to the snapshot + rerun migrations down if DB changes.
- [ ] For DB migrations: separate migrate-up from deploy; run the migration first with a `pg_locks` timeout; deploy only if the migration succeeds.
- [ ] Auto-revert on red: if health checks fail within N minutes post-deploy, roll back without user confirmation.

## Anti-patterns

- Do not deploy code + DB migration in one atomic step unless you can truly atomic-rollback both.
- Do not disable auto-revert for "this one critical deploy."
