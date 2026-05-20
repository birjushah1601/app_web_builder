---
name: gen-test-ai-feature
description: Generate personalization + privacy tests for an AIFeature node
activate_on: "node:aifeature"
model_hint: sonnet
---

# Generate Test — AIFeature

## When to use

Auto-activated when an `AIFeature` node is added or its personalization/inputModality/safetyContract changes.

## Checklist

- [ ] Personalization test: if personalized=true, verify ComplianceClass edge exists (I10).
- [ ] Input-modality test: every declared modality (text/image/audio/video) round-trips through the feature.
- [ ] Safety-contract test: inputs matching the contract's disallowed patterns are refused with the expected refusal message.
- [ ] Privacy-mode test: if privacyMode=`"on-device"`, no network call leaves the device during inference.
- [ ] Emit as Test node with `covers`-edge → AIFeature.
