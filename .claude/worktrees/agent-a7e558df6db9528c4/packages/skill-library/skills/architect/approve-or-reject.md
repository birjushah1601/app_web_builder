---
name: approve-or-reject
description: Persona-gated approval decision recorder for the Agree step
activate_on: "agree"
composes: ["visualize-diff"]
model_hint: haiku
---

# Approve or Reject

## When to use

Records the user's Agree-step decision as a typed event persisted to `@atlas/spec-graph-data.spec_events`. Persona rules from PRD §9.5 apply.

## Checklist

- [ ] Require 20+ chars of rationale for any risk-accept (per Unit F's RiskAccepted schema).
- [ ] Ama cannot emit `gate: "L4-security"` risk-accepts — escalate to Priya.
- [ ] Emit `ritual.agreed` with the approved artifact + decision metadata.
- [ ] On rejection, emit `ritual.rejected` + rationale + route back to Visualize.

## Output contract

One of two event shapes: `{ type: "ritual.agreed", artifact, approvedBy, timestamp }` or `{ type: "ritual.rejected", reason, routeBackTo: "visualize" }`.

## Anti-patterns

- Do not silently accept empty rationale.
- Do not allow Ama to bypass Security/Compliance risk-accepts.
