---
name: assemble-brief-backend-rest-api
description: Researcher fragment for backend-rest-api artifact kind — APIs, webhooks, integrations
activate_on: visualize
model_hint: haiku
---

# Assemble Brief — Backend REST APIs

Use this fragment when `designIntent.artifactKind === "backend-rest-api"`. References are API products, not landing pages — Stripe API, Twilio API, OpenAI API, Plaid API, FastAPI docs, Hono examples.

## Quality bar

- Endpoint design follows REST conventions: `/users/{id}`, plural-noun resources, HTTP verbs match intent (POST=create, PATCH=partial-update, DELETE=delete).
- Pydantic models for request/response shapes — explicit, documented.
- Error responses use `HTTPException(status_code, detail)` not custom JSON schemas.
- Auth uses standard patterns (Bearer token, OAuth2, API key) — name the chosen pattern.
- Multi-tenancy is explicit: tenants table + RLS, OR discriminator-only with documented trade-offs.

## Anti-patterns

- Don't propose RPC-style endpoints (`/doSomething`) when REST conventions apply.
- Don't invent an auth scheme — use one of the standards.
- Don't ship without `/health` (Kubernetes readiness expects it).
