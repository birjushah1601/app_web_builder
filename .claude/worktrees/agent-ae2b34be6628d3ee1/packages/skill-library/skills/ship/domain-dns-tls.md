---
name: domain-dns-tls
description: Provision a custom domain with Let's Encrypt TLS + CAA record + HTTPS-redirect
activate_on: "ship"
model_hint: sonnet
---

# Domain / DNS / TLS

## When to use

Ship-scope tasks that attach a custom domain to a deployed app.

## Checklist

- [ ] Add A/AAAA/ALIAS record pointing at the platform's ingress.
- [ ] Add CAA record restricting issuance to Let's Encrypt.
- [ ] Provision TLS via Let's Encrypt ACME HTTP-01 or DNS-01 challenge.
- [ ] Enforce HTTPS-redirect via 301.
- [ ] Set HSTS with `max-age=31536000; includeSubDomains` (no preload until validated).

## Anti-patterns

- Do not use self-signed certs in prod.
- Do not skip CAA — it's a cheap defence against mis-issuance.
