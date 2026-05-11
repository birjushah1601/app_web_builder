---
name: cors-policy
description: Enforce explicit CORS allowlists on every Endpoint; reject wildcards on credentialed routes
activate_on: "merge-gate.security"
model_hint: sonnet
---

# CORS Policy

## When to use

L4 merge gate. Runs on every diff that creates or modifies an Endpoint.

## Checklist

- [ ] Every Endpoint declares `cors.allowedOrigins` — a concrete list of origins or `"same-origin"`.
- [ ] Reject `cors.allowedOrigins: ["*"]` on any Endpoint where `cors.allowCredentials: true` — spec forbids it.
- [ ] Reject implicit CORS (no field) — every Endpoint must opt in explicitly.
- [ ] Allowed origins must be https:// except for `localhost` in development builds.

## Anti-patterns

- Do not whitelist a third-party origin without a signed data-processing agreement.
