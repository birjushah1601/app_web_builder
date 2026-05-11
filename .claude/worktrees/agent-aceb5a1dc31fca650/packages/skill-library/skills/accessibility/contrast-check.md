---
name: contrast-check
description: WCAG 2.2 AA contrast ratios across text + icons in both light and dark modes
activate_on: "merge-gate.a11y"
model_hint: haiku
---

# Contrast Check

## When to use

L5 merge gate. Runs on every Page + every DesignToken that defines a color pair.

## Checklist

- [ ] Text: foreground/background contrast ≥ 4.5:1 for body, ≥ 3:1 for large text (18pt regular or 14pt bold).
- [ ] UI components + icons: ≥ 3:1 against adjacent surfaces.
- [ ] Run the check in both light and dark modes if the app supports theme switch.
- [ ] DesignToken pairs that fail → the DesignToken is rejected, not the Page.

## Anti-patterns

- Do not use gray-on-white body text below 4.5:1 "for aesthetic reasons."
