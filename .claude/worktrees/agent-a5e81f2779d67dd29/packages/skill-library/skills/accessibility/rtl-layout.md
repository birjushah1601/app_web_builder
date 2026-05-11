---
name: rtl-layout
description: Verify layouts render correctly in RTL scripts (Arabic, Hebrew); no left/right hardcoded spacing
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# RTL Layout

## When to use

L5 merge gate. Runs on every Page that targets locales including Arabic, Hebrew, or Urdu.

## Checklist

- [ ] Confirm `<html dir="...">` is set from the locale, not hardcoded.
- [ ] Reject hardcoded `margin-left`/`padding-right` etc.; prefer `margin-inline-start`/`padding-inline-end`.
- [ ] Icons with directional semantics (arrows, chevrons) must flip under RTL. Use `transform: scaleX(-1)` or mirrored assets.
- [ ] Test the Page rendered under `dir="rtl"` in CI via Playwright; snapshot-compare key regions.

## Anti-patterns

- Do not use `text-align: left` — use `start`.
