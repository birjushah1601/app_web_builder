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

## TypeScript-native alternative (Hono + Bun)

For TypeScript-fluent teams, the `atlas-hono-bun` template is an opt-in alternative
to FastAPI for the same `backend-rest-api` artifact kind. Cite Hono examples
(https://hono.dev/examples/) and the Bun docs (https://bun.sh/docs) alongside FastAPI
when the user mentions Bun, Cloudflare Workers, edge runtime, or "TypeScript backend".
Cite Drizzle ORM patterns (https://orm.drizzle.team/docs/overview) for schema + query
work in the Hono path.

### Hono-specific quality bar

- Use `@hono/zod-validator` for typed request validation; do not hand-roll Zod parsing in route handlers.
- Throw `HTTPException(status, { message })` for HTTP errors — not a hand-rolled `c.json({ error }, status)`.
- Define route groups in `src/routes/<feature>.ts` and mount via `app.route("/<prefix>", featureRouter)` — single-file routing only for trivial APIs.

### Hono + Bun anti-patterns

- Don't propose Express middleware idioms (req, res, next) — Hono uses Context (c) + return.
- Don't propose Prisma alongside Drizzle — pick one ORM per project (this template ships Drizzle).
- Don't propose `dotenv` — Bun auto-loads `.env`.
