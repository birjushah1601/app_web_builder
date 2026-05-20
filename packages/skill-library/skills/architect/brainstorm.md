---
name: brainstorm
description: Explore user intent before committing to a spec graph; surface unknowns as structured questions
activate_on: "visualize"
model_hint: haiku
---

# Brainstorm

## When to use

The Architect role composes this skill as its first step whenever a user intent enters the Visualize phase. Use it to:

- Extract the product scope from a free-text request.
- Enumerate ambiguities (missing auth requirements, unstated compliance class, unclear data shape).
- Produce a structured `AmbiguityReport` that Pass 1 of the Architect role emits.

Do **not** use this skill to generate spec-graph nodes or wireframes — that is `spec-graph.md`. Brainstorm is a pre-step.

## Checklist

- [ ] Restate the user's intent in one sentence.
- [ ] Identify the **scope** (new-app / new-feature / bug-fix / upgrade / refactor / ship / migrate).
- [ ] List unknowns as questions, each tagged `severity: "blocker" | "recommended"`.
- [ ] Blockers: compliance class (HIPAA, GDPR, DPDP-India?), data-residency region, auth provider, DB provider, payment regions.
- [ ] Recommended: brand tokens, i18n targets, mobile/desktop priority, offline requirements.

## Output contract

```
AmbiguityReport {
  passed: boolean                # true if no blockers
  questions: Array<{ question, reason, severity }>
}
```

## Anti-patterns

- Do not invent a compliance class when the user didn't mention one — ask.
- Do not collapse multiple ambiguities into one multi-part question — the user should be able to answer each separately.
