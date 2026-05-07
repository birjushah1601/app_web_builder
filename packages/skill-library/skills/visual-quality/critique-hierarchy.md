---
name: critique-hierarchy
description: WCAG contrast, alignment, visual hierarchy of the rendered output
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Hierarchy + Contrast + Alignment

## When to use

Composed by the Visual-Quality gate to assess whether the rendered output follows basic visual-design hygiene independent of the chosen tokens.

## Checklist

- [ ] Body text contrast >= 4.5:1 (WCAG AA) — flag failures as `category: "contrast"`, severity `major`.
- [ ] Large text (>=18pt) contrast >= 3:1.
- [ ] Visual hierarchy: H1 > H2 > H3 in size + weight — flag inversions (`category: "hierarchy"`, `major`).
- [ ] Alignment: primary surfaces share a consistent grid baseline. Random pixel offsets = `category: "alignment"`, `minor`.
- [ ] Focus: ONE clear primary CTA above the fold — multiple competing CTAs = `category: "hierarchy"`, `major`.

## Output contract

Issues with `category: "contrast" | "hierarchy" | "alignment"`. Severity reflects user impact, not aesthetic preference.

## Anti-patterns

- Don't flag intentional creative choices (e.g. all-lowercase headers, asymmetric layouts) as alignment failures unless they break readability.
- Don't downgrade accessibility issues to "minor" — contrast failures are at least `major`.
