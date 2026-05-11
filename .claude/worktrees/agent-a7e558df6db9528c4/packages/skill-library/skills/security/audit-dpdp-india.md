---
name: audit-dpdp-india
description: India DPDP Act 2023 evidence checks — consent, data localization, breach reporting
activate_on: "merge-gate.security"
model_hint: opus
---

# Audit DPDP-India

## When to use

L4 merge gate. Runs on every diff in a project whose ComplianceClass set contains `DPDP-India`, OR that touches a Model with `piiClassification !== "none"` AND a DataResidency node referencing India / `IN`.

## Checklist

- [ ] **Notice + consent** — Every PII collection point must surface a notice in English and at least one of the 22 scheduled Indian languages. Check Page metadata for a `noticeRef` field and reject Pages that collect PII without one.
- [ ] **Purpose limitation** — Each PII Model must declare a `purpose: string` field describing why this data is being collected. Reject PII collection for vague purposes ("analytics", "improvement").
- [ ] **Data fiduciary obligations** — The project must declare a Data Protection Officer (DPO) reference if classified as a Significant Data Fiduciary. Check the project metadata for `dpoRef` or `significantDataFiduciary: false`.
- [ ] **Localization** — Personal data classified as `sensitive` must have a `storesDataIn` edge to a DataResidency node with `jurisdiction: "IN"`, OR an explicit cross-border transfer approval marker. Reject sensitive data flowing to a Region whose `cloudProviderRef` points outside India without that marker.
- [ ] **Breach notification** — Confirm the project has an incident-response runbook (look for `.atlas/runbooks/breach-notification.md` or equivalent). DPDP requires notification to the Data Protection Board within 72 hours.
- [ ] **Right to erasure** — Every PII Model must expose either an `eraseEndpoint` reference or compose with the `right-to-erasure` skill. Reject PII Models that have no defined deletion path.
- [ ] **Children's data** — If the app's stated audience includes users under 18, confirm parental consent flow exists. Look for an `ageGateRef` on Pages collecting PII.

## Anti-patterns

- Do not accept "GDPR compliance covers DPDP" — the localization clause has no GDPR equivalent.
- Do not accept English-only notice — local-language notice is a hard requirement.
- Do not accept implicit consent (pre-checked boxes, scroll-to-consent) — DPDP requires explicit, granular, withdrawable consent.

## Evidence emitted

A pass emits an `evidence-dpdp-india.json` artifact mapping each clause of the DPDP Act 2023 to the satisfying check. The evidence pack feeds the Data Protection Officer's annual report.
