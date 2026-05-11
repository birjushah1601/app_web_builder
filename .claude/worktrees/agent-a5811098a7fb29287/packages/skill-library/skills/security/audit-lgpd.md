---
name: audit-lgpd
description: Brazil LGPD evidence checks — legal basis, data subject rights, ANPD reporting
activate_on: "merge-gate.security"
model_hint: opus
---

# Audit LGPD

## When to use

L4 merge gate. Runs on every diff in a project whose ComplianceClass set contains `LGPD`, OR that touches a Model with `piiClassification !== "none"` AND a DataResidency / Region node pointing to Brazil (`BR`).

## Checklist

- [ ] **Legal basis declared** — Every PII Model must declare one of the 10 LGPD legal bases (consent, legitimate interest, contract, legal obligation, etc.) in `lawfulBasis: string`. Reject PII collection without a declared basis.
- [ ] **Sensitive personal data extra protection** — LGPD treats race, religion, political opinion, health, biometric, sexual orientation, etc. as `dadosSensiveis`. These require explicit, specific, prominent consent. Check that Models with `piiClassification: "sensitive"` reference an explicit-consent capture flow.
- [ ] **Data Protection Officer (Encarregado)** — Project metadata must declare an `encarregadoRef` (DPO equivalent). LGPD makes the DPO a public-facing role with their contact info on the project's privacy page.
- [ ] **International transfers** — Cross-border data transfers must be to a country with adequate-protection status, OR via standard contractual clauses, OR with explicit consent. Check for cross-region `storesDataIn` edges and verify the receiving Region is approved or accompanied by an SCC marker.
- [ ] **Subject rights endpoints** — Confirm endpoints exist for: confirmation of processing, access, correction, anonymization, portability, deletion, withdrawal of consent. Check the project for at least 7 named endpoints in `lgpd-rights/` or equivalent.
- [ ] **Data breach notification to ANPD** — Project must have incident-response process surfacing notifications to the Autoridade Nacional de Proteção de Dados within a "reasonable time" (jurisprudence converging on 48-72 hours). Look for `.atlas/runbooks/anpd-notification.md`.
- [ ] **Records of Processing Activities (ROPA)** — Confirm a generated ROPA artifact exists (`.atlas/evidence/lgpd-ropa.json`). LGPD Article 37 requires processing records.

## Anti-patterns

- Do not accept "LGPD is GDPR with a Portuguese accent" — the lawful-basis enumeration differs and Brazilian jurisprudence on consent is stricter on prominence.
- Do not accept consent banners that bundle multiple processing purposes — granular consent is required.
- Do not accept the absence of a Brazil-resident DPO for projects targeting Brazilian users — ANPD has explicitly cited absence of an Encarregado as a fineable offense.

## Evidence emitted

A pass emits an `evidence-lgpd.json` artifact mapping each LGPD article to the satisfying check. Pairs with the ROPA generator for ANPD-ready evidence packs.
