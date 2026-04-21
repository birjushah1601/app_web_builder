---
name: audit-pci-dss
description: PCI-DSS v4.0 evidence checks for any project handling cardholder data
activate_on: "merge-gate.security"
model_hint: opus
---

# Audit PCI-DSS

## When to use

L4 merge gate. Runs on every diff in a project whose ComplianceClass set contains `PCI-DSS`, OR that touches a Model declaring fields named `pan`, `cvv`, `cardNumber`, `cardExpiry`, or any field tagged `piiClassification: "sensitive"` with payment context.

## Checklist

- [ ] No raw PAN (Primary Account Number) is ever logged. Search for `console.log`, `log.info`, error messages, and JSON serializers that touch cardholder fields — they must redact to last-4 only.
- [ ] PAN at rest is either tokenized (preferred) or encrypted with strong cryptography (AES-256 or equivalent). Confirm the storage Model has either `tokenized: true` or an explicit encryption-at-rest declaration.
- [ ] Transmission of cardholder data is TLS 1.2+ only. Reject any code path that uses HTTP for payment endpoints.
- [ ] CVV (`cvv`, `cvc`, `cardSecurityCode`) is **never** stored after authorization. Reject any Model with a CVV field that lacks an explicit `transient: true` marker.
- [ ] Access to cardholder data requires multi-factor authentication. Confirm the AuthBoundary on payment-handling Endpoints has `mfaRequired: true` or composes with an `mfa-check` skill.
- [ ] Cardholder Data Environment (CDE) network segmentation: payment-handling services must be on a separate network plane from non-CDE services. Flag deployment configs that put payment endpoints alongside marketing endpoints.

## Anti-patterns

- Do not accept "we use Stripe so we don't have to comply" — even Stripe-tokenized flows can leak PAN through bad logging or insecure transmission.
- Do not accept CVV storage with TTL — PCI-DSS forbids CVV storage entirely after the transaction completes.
- Do not accept "we'll add MFA in a follow-up" for payment-data access. L4 is a blocker.

## Evidence emitted

A pass emits an `evidence-pci-dss.json` artifact summarizing which checks ran and their outcomes. The evidence pack feeds the QSA assessment workflow.
