---
name: critique-design-tokens
description: Detect drift between the user's chosen DesignTokens and what the rendered output actually shows
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Design-Token Drift

## When to use

The Visual-Quality gate composes this skill to check whether the rendered preview honors the DesignTokens the user picked (palette, typography, density, componentSet).

## Checklist

- [ ] Compare the rendered hero/primary surface's accent color to `tokens.palette.accent`. Flag drift > ~10% hue shift as `category: "design-token-drift"`, severity scaled by visibility.
- [ ] Compare rendered headline font to `tokens.typeScale.serifFamily` / `sansFamily`. Wrong font family = critical (the user's pick was ignored).
- [ ] Compare density (paddings, line-height, surface gaps) against `tokens.density: "compact" | "comfortable" | "spacious"`. Significant mismatch = major.
- [ ] Verify shadcn/ui components render with their `--atlas-*` CSS variable values, not raw hex codes from inline styles.

## Output contract

Issues with `category: "design-token-drift"`. Severity:
- `critical` = wrong palette or wrong font family on the hero surface
- `major` = density mismatch on primary surface
- `minor` = subtle accent or border-radius drift

## Anti-patterns

- Don't penalize intentional contrast within the chosen palette (e.g. accent-on-dark-background).
- Don't flag dynamic content (timestamps, generated IDs) as drift.
