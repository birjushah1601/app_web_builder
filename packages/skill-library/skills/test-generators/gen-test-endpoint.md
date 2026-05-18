---
name: gen-test-endpoint
description: Generate request/response contract tests + auth + rate-limit tests for an Endpoint node
activate_on: "node:endpoint"
model_hint: sonnet
---

# Generate Test — Endpoint

## When to use

Auto-activated when an `Endpoint` node is added or its method/path/inputs/outputs/authBoundary/rateLimit change.

## Checklist

- [ ] Request-body test: valid payload returns 200 + matching outputs shape; invalid payload returns 400.
- [ ] Auth test: if AuthBoundary present, unauthed call returns 401; wrong-role call returns 403.
- [ ] Rate-limit test: (rateLimit+1) calls in the window return 429.
- [ ] PII+compliance test: if the Endpoint mutates a PII Model, confirm invariant I04 passes (endpoint has both AuthBoundary and ComplianceClass requires-edges).
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → Endpoint.
