---
name: audit-rls
description: Test fixture — minimal audit-rls skill
activate_on: security
---

# Audit RLS (fixture)

- Verify every model exposes rlsPolicies.select and rlsPolicies.insert.
- Flag missing RLS policies as SEC-RLS-001.
- Report critical when a model is fully unprotected.
