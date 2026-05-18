---
name: audit-rls
description: Verify every PII-bearing Model has Row-Level-Security policies covering select/insert/update/delete
activate_on: "merge-gate.security"
model_hint: opus
---

# Audit RLS

## When to use

L4 merge gate. Runs on every diff that touches a Model node with `piiFields: [...]`.

## Checklist

- [ ] For every Model with `piiFields` non-empty: confirm `rlsPolicies` covers all four of `select`, `insert`, `update`, `delete`.
- [ ] Each policy must reference the tenant identity (`auth.uid()` or equivalent).
- [ ] Reject policies that use `USING (true)` — that's a missing policy, not a real one.
- [ ] Confirm invariant I05 passes (`I05_PII_MODEL_MISSING_RLS` not in validator output).

## Anti-patterns

- Do not accept "we'll add RLS later" — L4 is a blocker gate.
- Do not accept RLS policies that depend on app-level role claims without a DB-level check.
