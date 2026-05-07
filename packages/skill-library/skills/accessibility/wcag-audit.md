---
name: wcag-audit
description: Run axe-core against every Page; fail merge ONLY on measured WCAG 2.2 AA violations
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# WCAG Audit

## When to use

L5 merge gate. Runs on every diff that creates or modifies a Page.

## Severity tiers (CRITICAL — read before issuing reports)

The auto-fix loop (Plan L) ONLY triggers on `critical` severity. Misclassifying a nudge as critical sends the loop into an unfixable spiral and burns the user's auto-fix budget for nothing. Be deliberate.

- **`critical`** — Reserve for MEASURED, REPRODUCIBLE failures. Examples that qualify:
  - axe-core actually flagged a rule with `impact: "critical"`
  - `<img>` tag has no `alt` attribute (visible in source — measurable, not "may have")
  - Click-only `<div>` with no `role="button"` AND no `onKeyDown` (literally untraceable by keyboard)
  - Form input has no associated `<label>` and no `aria-label` and no `aria-labelledby`
  - `outline: none` with no replacement focus indicator anywhere
- **`major`** — Confirmed issue but recoverable / partial impact. Examples:
  - axe `impact: "serious"`
  - Non-semantic markup that screen readers handle awkwardly but not catastrophically
  - Missing `aria-current` on the active item in a list
- **`minor`** — Best-practice nudge, polish, or anything you cannot verify with measurement. Examples:
  - "Potential contrast issue" without an actual computed ratio
  - "May not meet 4.5:1 in some scenarios"
  - Missing arrow-key navigation in a tablist (keyboard works via Tab; arrow-key is per ARIA APG, not WCAG-required)
  - Missing `dir="..."` for RTL when the project hasn't declared RTL locale support
  - "Depending on the gradient blend"
  - Cosmetic suggestions ("could include focus-visible:ring for consistency")

## Checklist

- [ ] If you can run axe-core, do — its `impact` field maps directly to severity (critical → critical, serious → major, moderate/minor → minor).
- [ ] Without axe-core, audit by inspection but apply the severity tiers above strictly.
- [ ] Report violations with: rule, impact, element selector, remediation hint.
- [ ] If you cannot reproduce or measure an issue, demote to `minor` or omit. **Speculation is not a critical finding.**

## Anti-patterns

- **Do NOT mark "potential" / "may" / "depending on" findings as `critical` or `major`.** If you didn't measure it, it doesn't block the gate.
- Do not gate the same finding twice across critical+minor.
- Do not list aspirational ARIA APG patterns as WCAG-required.
