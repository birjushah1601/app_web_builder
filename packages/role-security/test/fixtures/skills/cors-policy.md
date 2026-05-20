---
name: cors-policy
description: Test fixture — minimal cors-policy skill
activate_on: security
---

# CORS Policy (fixture)

- Check that allowedOrigins does not contain wildcards on credentialed routes.
- Flag permissive CORS as SEC-CORS-001 through SEC-CORS-010.
- Report high severity for wildcard + credentials combinations.
