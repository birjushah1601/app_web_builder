---
name: secrets-scan
description: Block commits that include literal secrets; route all secret-like values through env/secret-manager
activate_on: "merge-gate.security"
model_hint: haiku
---

# Secrets Scan

## When to use

L4 merge gate. Runs on every diff.

## Checklist

- [ ] Scan diff for high-entropy strings (AWS keys, Stripe secret keys, JWT signatures, Postgres URLs with password).
- [ ] Match known patterns: `AKIA[0-9A-Z]{16}`, `sk_live_[0-9a-zA-Z]{24,}`, `postgresql://[^:]+:[^@]+@`, `-----BEGIN (RSA )?PRIVATE KEY-----`.
- [ ] Reject any literal match. The fix is always: move the value to an env var or secret manager + reference by `connectionStringRef: "env:VAR_NAME"`.
- [ ] Confirm no `.env*` files are being committed unless they're `.env.example` with placeholder values.

## Anti-patterns

- Do not rely on `.gitignore` as the only defence — the scan must run on the diff, not on the working tree.
