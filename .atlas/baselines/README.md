# Human Baselines

Files in this directory define **non-overridable security and compliance assertions** that LLM-generated test code must always satisfy. They are authored by humans and pulled into the test-generator prompt by `@atlas/test-generator-registry`.

## Which kinds are covered

| File | Covers | Owner |
|------|--------|-------|
| `authboundary.yaml` | Every AuthBoundary node (I13 mandatory) | security-team |
| `pii-model.yaml` | Every Model with `piiClassification !== "none"` (I13 mandatory) | security-team |
| `compliance.yaml` | Every ComplianceClass whose `name !== "baseline"` (I13 mandatory) | compliance-team |

## Editing

- Keep the `id` stable across revisions — calibration snapshots pin to it.
- Bump `version` when assertions change; the drift detector will flag all pinned calibrations for that kind.
- Add new assertions by appending; do not renumber.

## Why not let the LLM write these

The Council flagged in PRD §10.1 that LLM-generated tests can drift under prompt changes or model upgrades. Anchoring the security floor in human-authored YAML makes the floor immutable across model swaps.
