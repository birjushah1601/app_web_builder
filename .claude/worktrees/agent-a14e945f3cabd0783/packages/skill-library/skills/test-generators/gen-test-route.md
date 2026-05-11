---
name: gen-test-route
description: Generate HTTP contract tests for a Route node (method + path + status)
activate_on: "node:route"
model_hint: haiku
---

# Generate Test — Route

## When to use

Auto-activated when a `Route` node is added or its `method`/`path`/`auth` changes.

## Checklist

- [ ] HTTP test: fetch Route.path with Route.method; assert expected status (200/201/204 for happy path per method).
- [ ] Auth test: if Route carries an AuthBoundary requires-edge, assert unauthed call returns 401 / 403.
- [ ] Handler-type test: if Route.handlerType is `"server-action"`, assert the form submit round-trip; if `"api"`, assert JSON response shape.
- [ ] Emit as Test node with `covers`-edge → Route.
