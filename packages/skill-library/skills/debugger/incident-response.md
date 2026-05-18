---
name: incident-response
description: Production incident triage — stabilize first, understand second, fix third
activate_on: "incident"
composes: ["four-phase-debug"]
model_hint: sonnet
---

# Incident Response

## When to use

Production alert fires, or a user reports a live outage. Not for local dev failures — those use `four-phase-debug` directly.

## Checklist

- [ ] **Stabilize.** Roll back the most recent deploy if the incident started within its window. Pause non-critical traffic if the error rate is > baseline × 5.
- [ ] **Communicate.** Post an incident start timestamp to the team channel. Post every 15 minutes until resolved.
- [ ] **Triage scope.** Is this a full outage (dashboard down, 5xx on /)? Partial (one route, one region, one tenant)? Degraded (latency + success)?
- [ ] **Gather evidence.** Logs, traces, metrics, recent commits, recent config changes, upstream provider status pages.
- [ ] **Handoff to four-phase-debug** once stabilised. The incident is closed when the fix has landed + a post-mortem is scheduled.

## Anti-patterns

- Do not hot-fix in prod before stabilising. A bad hot-fix extends the incident.
- Do not skip the post-mortem. The cost is low; the learning is high.
