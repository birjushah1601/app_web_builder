---
name: gen-test-auth-boundary
description: Generate baseline security tests for an AuthBoundary node (required by I13)
activate_on: "node:authboundary"
model_hint: opus
---

# Generate Test — AuthBoundary

## When to use

Auto-activated when an `AuthBoundary` node is added. AuthBoundary test coverage is mandated by invariant I13 (`I13_PROTECTED_TARGET_MISSING_BASELINE_TEST`).

## Checklist

- [ ] Unauthed access returns 401 + correct redirect.
- [ ] Authed-but-wrong-role access returns 403.
- [ ] Role elevation after re-auth grants access (if roles support elevation).
- [ ] Session expiry returns 401 and re-auth flow.
- [ ] Emit as Test node with `source: "baseline"` (human-authored equivalent — the LLM cannot rewrite this) and `covers`-edge → AuthBoundary.

## Anti-patterns

- Do not emit baseline tests that depend on app-level role names — use the AuthBoundary's declared roles directly.
