---
name: keyboard-nav
description: Every interactive element reachable + operable via keyboard; focus visible; logical tab order
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# Keyboard Navigation

## When to use

L5 merge gate. Runs on every Page.

## Checklist

- [ ] Every Component with an `onClick` handler also has an `onKeyDown` that triggers on Enter/Space, OR is rendered as a semantic `<button>`/`<a>`.
- [ ] Focus is visible — no `outline: none` without a replacement.
- [ ] Tab order follows visual order (no negative tabindex except for programmatically-focused containers).
- [ ] Modal dialogs trap focus + restore on close.

## Anti-patterns

- Do not use `<div onClick>` without `role="button"` + `tabindex="0"` + keyboard handler.
