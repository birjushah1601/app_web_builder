---
name: secrets-scan
description: Test fixture — minimal secrets-scan skill
activate_on: security
---

# Secrets Scan (fixture)

- Scan the proposed diff for hardcoded secrets, tokens, and credentials.
- Flag any detected secret as SEC-SCRT-001.
- Report critical when a live credential is committed to the diff.
