---
name: contrast-check
description: WCAG 2.2 AA contrast ratios — fail ONLY on computed (not speculated) failures
activate_on: "merge-gate.a11y"
model_hint: haiku
---

# Contrast Check

## When to use

L5 merge gate. Runs on every Page + every DesignToken that defines a color pair.

## Severity tiers (read before reporting)

The auto-fix loop only triggers on `critical`. Demoting unmeasurable speculation to `minor` is REQUIRED — otherwise the loop spirals on issues that can't be confirmed.

- **`critical`** — Computed ratio falls below threshold for an opaque foreground/opaque background pair. You did the math (or the framework did) and the result is < 4.5:1 (body) or < 3:1 (large text / UI components).
- **`major`** — Computed below threshold for a translucent surface (rgba/backdrop-blur) where you measured the EFFECTIVE color blend with the worst-case backdrop content.
- **`minor`** — Anything you cannot compute. Examples that MUST stay minor:
  - "Potential contrast issue: text-slate-600 on a gradient" (gradients don't have a single contrast ratio — pick one extreme and measure if you want to upgrade severity)
  - "May fall below 4.5:1 in some scenarios" (specify which scenario + measure)
  - "bg-white/80 backdrop with gradient bleed-through could reduce contrast" (depends on user content; mark minor + suggest measuring with worst-case content)
  - Decorative text where the contrast doesn't matter for comprehension

## Checklist

- [ ] Text: foreground/background contrast ≥ 4.5:1 for body, ≥ 3:1 for large text (≥18pt regular OR ≥14pt bold).
- [ ] UI components + icons: ≥ 3:1 against adjacent surfaces.
- [ ] Run the check in both light and dark modes if the app supports theme switch.
- [ ] If the foreground or background is translucent (`bg-white/80`, `text-white/50`), compute against the underlying solid layer; if you can't pin a solid layer, demote to `minor`.
- [ ] DesignToken pairs that fail (with measurement) → reject the DesignToken, not the Page.

## Anti-patterns

- **Do NOT report "potential" or "may not meet" findings as `critical`.** If you didn't compute the ratio, it isn't a critical finding.
- Do not flag gradient text as critical without picking a specific gradient stop and measuring against the foreground.
- Do not use gray-on-white body text below 4.5:1 "for aesthetic reasons" — but only flag this when the ratio IS measured and below.
