---
name: auth-wire
description: Wire the chosen auth provider (Clerk / Supabase Auth / Lucia) into the deployed app
activate_on: "ship"
model_hint: sonnet
---

# Auth Wire

## When to use

Ship-scope tasks after the user has selected an auth provider at Visualize.

## Checklist

- [ ] Provision OAuth apps in the provider dashboard; store client IDs/secrets in the secret manager.
- [ ] Wire the provider's SDK into the app with the correct redirect URLs (production domain, not localhost).
- [ ] Confirm every AuthRequired Page redirects to the sign-in flow.
- [ ] Verify session persistence across reloads + cookie SameSite/Secure flags.
- [ ] Run a smoke test: sign-up → email verify → sign-in → protected page → sign-out.

## Anti-patterns

- Do not hardcode provider URLs in code — use env-referenced config.
- Do not ship with provider test keys ("pk_test_..."); always switch to live keys pre-launch.
