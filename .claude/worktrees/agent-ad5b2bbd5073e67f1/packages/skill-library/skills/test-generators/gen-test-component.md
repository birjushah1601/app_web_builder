---
name: gen-test-component
description: Generate React Testing Library tests for a Component node
activate_on: "node:component"
model_hint: haiku
---

# Generate Test — Component

## When to use

Auto-activated when a `Component` node is added or its props/state/events change.

## Checklist

- [ ] Render test: the component renders without throwing given minimal valid props.
- [ ] Props-matrix test: every prop variant documented in the Component produces the expected structure.
- [ ] Event test: every documented event handler fires with expected payload.
- [ ] Emit as Test node with `covers`-edge → Component.
