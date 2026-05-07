---
name: rtl-layout
description: Verify RTL layouts when the project declares RTL locale support — otherwise a nudge, not a blocker
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# RTL Layout

## When to use

L5 merge gate. Runs on every Page.

## Severity tiers (CRITICAL)

RTL is only a **gating concern** when the project explicitly targets RTL locales (Arabic, Hebrew, Urdu, Persian) — that intent comes from `designIntent.audienceCues` or the architect's spec, not from the gate's own assumption. If the project hasn't declared RTL targets, RTL findings are `minor` (nudges) and MUST NOT trigger the auto-fix loop.

- **`critical`** — Project declared RTL locale support AND a hardcoded directional property is causing visible mirroring failure (text running left-to-right inside a right-to-left page; controls in the wrong corner). Verify by asking: would a user actually see broken layout?
- **`major`** — Project declared RTL AND a directional property exists but its effect is cosmetic (slightly off margin, icon faces wrong way).
- **`minor`** — Default. Project did not declare RTL support, OR the issue is "could be improved when you add RTL later". Examples:
  - "No `<html dir=...>` management" — `minor` unless a target locale needs it now
  - "ml-2 used; should be ms-2 for RTL support" — `minor` unless RTL is in scope
  - "Icons not flipping for RTL" — `minor`
  - "Arrow key navigation should account for RTL direction" — `minor`

## Checklist

- [ ] First: does `designIntent.audienceCues` mention any RTL locale (e.g., "arabic", "hebrew", "urdu", "rtl", "middle-east")?
  - If NO → all RTL findings are `minor`. Stop here unless you want to nudge.
  - If YES → continue with the substantive checks below.
- [ ] Confirm `<html dir="..."` is set from the locale, not hardcoded.
- [ ] Hardcoded `margin-left`/`padding-right` etc. → suggest `margin-inline-start`/`padding-inline-end`.
- [ ] Icons with directional semantics (arrows, chevrons) must flip under RTL. Use `transform: scaleX(-1)` or mirrored assets.
- [ ] Test the Page rendered under `dir="rtl"` if you have a Playwright shot.

## Anti-patterns

- **Do NOT mark RTL findings as `critical` when the project has no declared RTL audience.** Most projects don't ship to RTL on day one.
- Do not flag every `ml-`/`pr-` Tailwind utility as critical even when RTL IS in scope — only the ones that actually break the layout in a screenshot.
- Do not use `text-align: left` when RTL is in scope; use `start`. Otherwise this is a nudge.
