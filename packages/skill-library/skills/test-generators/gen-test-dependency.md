---
name: gen-test-dependency
description: Generate CVE + license + upgrade-path tests for a Dependency node
activate_on: "node:dependency"
model_hint: haiku
---

# Generate Test — Dependency

## When to use

Auto-activated when a `Dependency` node is added or its version changes.

## Checklist

- [ ] CVE test: query osv.dev / npm audit; fail on critical severity (I06).
- [ ] License test: fail on copyleft licenses (GPL, AGPL) unless the app itself is OSS + accepts.
- [ ] Version-range test: if the Dependency declares `supportedMajorRange`, confirm the current version is within it.
- [ ] Emit as Test node with `covers`-edge → Dependency.
