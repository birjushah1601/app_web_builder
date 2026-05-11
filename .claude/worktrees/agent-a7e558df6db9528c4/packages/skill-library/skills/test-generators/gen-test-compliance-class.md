---
name: gen-test-compliance-class
description: Generate baseline compliance-evidence tests for a ComplianceClass node (required by I13 for non-baseline)
activate_on: "node:compliance"
model_hint: opus
---

# Generate Test — ComplianceClass

## When to use

Auto-activated when a `ComplianceClass` node is added. Non-baseline ComplianceClasses require a `source: "baseline"` Test per I13.

## Checklist

- [ ] For each assertion in ComplianceClass.baselineAssertions, emit a concrete test that exercises it.
- [ ] HIPAA: audit-log presence, PHI field encryption at rest, BAA-traceable provider list.
- [ ] GDPR: data-subject-access-request endpoint returns user's data in 30 days, deletion endpoint scrubs across Models.
- [ ] DPDP-India: data-fiduciary consent-capture event for every PII-write.
- [ ] Emit as Test node with `source: "baseline"` and `covers`-edge → ComplianceClass.

## Anti-patterns

- Do not auto-generate compliance assertions — they must be human-authored to be defensible.
