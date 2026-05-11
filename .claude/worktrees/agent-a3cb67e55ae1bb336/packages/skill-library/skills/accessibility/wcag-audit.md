---
name: wcag-audit
description: Run axe-core against every Page; fail the merge on any WCAG 2.2 AA violation
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# WCAG Audit

## When to use

L5 merge gate. Runs on every diff that creates or modifies a Page.

## Checklist

- [ ] Run axe-core against the rendered Page (in the E2B sandbox or a headless Playwright).
- [ ] Fail on any WCAG 2.2 AA violation.
- [ ] Report violations with: rule, impact, element selector, remediation hint.
- [ ] Do not accept "false positive" without a code annotation explaining why + a dated TODO to revisit.

## Anti-patterns

- Do not rely on the designer's "it looked fine" — axe catches things the eye doesn't.
