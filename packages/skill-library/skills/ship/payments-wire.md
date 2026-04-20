---
name: payments-wire
description: Wire Stripe (or regional alt) with idempotency keys, webhook signatures, reconciliation
activate_on: "ship"
model_hint: opus
---

# Payments Wire

## When to use

Ship-scope tasks that enable payments on the deployed app.

## Checklist

- [ ] Use idempotency keys on every payment-creation call (replay-safe).
- [ ] Verify webhook signatures; reject unsigned or stale webhooks (>5 min).
- [ ] Store raw webhook bodies for reconciliation.
- [ ] Tax handling: select the right tax provider per region (Stripe Tax, custom, or out-of-scope).
- [ ] PCI scope: never store card data; always hand off to provider-hosted forms (Checkout, Elements).
- [ ] Reconciliation: nightly job compares provider-side balances to app-side records; alert on drift > 0.01%.

## Anti-patterns

- Do not store PANs.
- Do not skip webhook signature verification — it's the only thing standing between you and a malicious caller forging a "paid" status.
