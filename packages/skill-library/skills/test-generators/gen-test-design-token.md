---
name: gen-test-design-token
description: Generate contrast + token-usage tests for a DesignToken node
activate_on: "node:designtoken"
model_hint: haiku
---

# Generate Test — DesignToken

## When to use

Auto-activated when a `DesignToken` node is added.

## Checklist

- [ ] Contrast test: if the token is a color pair (fg/bg), assert WCAG 2.2 AA contrast ratios.
- [ ] Usage test: confirm the token is referenced by at least one Component (else it's dead token).
- [ ] Theme-switch test: if the token has `lightValue` + `darkValue`, both pass contrast in their respective modes.
- [ ] Emit as Test node with `covers`-edge → DesignToken.
