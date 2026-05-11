---
name: gen-test-model
description: Generate DB-contract tests for a Model node (schema + RLS + CRUD)
activate_on: "node:model"
model_hint: sonnet
---

# Generate Test — Model

## When to use

Auto-activated when a `Model` node is added or its fields / RLS / indexes change.

## Checklist

- [ ] Schema test: inserting a row with all required fields succeeds; missing fields fail.
- [ ] RLS test: two tenants cannot read each other's rows; each CRUD op is tested per tenant.
- [ ] Index test: queries using declared indexes use them (EXPLAIN ANALYZE spot-check).
- [ ] PII test: if piiFields is non-empty, confirm RLS covers all four ops (I05).
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → Model.
