---
name: assemble-brief-backend-graphql
description: Researcher fragment for backend-graphql artifact kind — GraphQL APIs, schemas, federated services
activate_on: visualize
model_hint: haiku
---

# Assemble Brief — Backend GraphQL APIs

Use this fragment when `designIntent.artifactKind === "backend-graphql"`. References are GraphQL API products and well-known public schemas — Hasura, GitHub GraphQL API, Linear API, Shopify Storefront API, Stripe (GraphQL preview), Contentful, GraphCMS / Hygraph. NOT REST API products (those are for `backend-rest-api`); NOT landing pages (those are `frontend-app`).

## Quality bar

- **Schema design follows graph-shape conventions.** Plural query roots return `Connection`-style cursor pagination (`edges { node { ... } cursor } pageInfo`), not bare arrays. Singular fetches by ID use `Node`-interface conformance where useful (Relay-style global IDs).
- **Mutations follow the input-payload pattern.** Inputs go through a single `input: SomethingInput!` argument; payloads return both the mutated entity and a `userErrors` array (Shopify-style — far more useful than throwing GraphQL errors for validation failures).
- **Errors split into "system errors" (GraphQL `errors` array — auth, rate-limit, internal) vs. "domain errors" (`userErrors` field on mutation payloads — validation, business rules).** The Researcher MUST cite at least one peer schema (Shopify, Linear) that follows this split.
- **Auth uses standard patterns.** Bearer token in `Authorization` header (GitHub, Linear) OR API key in `X-API-Key` (Stripe-style). Do NOT invent auth headers.
- **Pagination MUST be cursor-based, not offset-based** for any unbounded list. Cite Relay's connection spec.
- **N+1 batching is non-negotiable.** Cite Pothos's Drizzle plugin or DataLoader as the chosen mechanism.
- **Multi-tenancy is explicit.** Tenants table + RLS, OR a `viewer` field on the root Query that scopes child resolvers to the current actor (GitHub-style `viewer { repositories { ... } }`).
- **Smoke-test field present.** Schema MUST include a `hello: String!` (or similar) trivial query field that proves the server is up — matches the `/health` REST pattern.

## Anti-patterns

- Don't propose RPC-style fields (`doSomething: Boolean`) when graph-shape resolves the same intent (`updateOrder(input: ...): UpdateOrderPayload`).
- Don't return raw arrays for list fields. Always use `Connection`-shape pagination.
- Don't return `errors: [String]` from mutation payloads — use a typed `userErrors: [UserError!]!` with `field: [String!]`, `code: ErrorCode!`, `message: String!`.
- Don't invent custom scalars (`DateTime`, `UUID`) without citing where they're defined. Use Pothos's built-in scalars or import from `graphql-scalars`.
- Don't ship a schema with mutations but no `input` types — every mutation must take a single `input: <Mutation>Input!` argument for forward compatibility.
- Don't ship without subscriptions when the user prompt mentions "live", "real-time", "feed", "notifications" — subscriptions are GraphQL's superpower; missing them is a missed opportunity.
- Don't propose Apollo Federation for a 1-service project (overkill).

## Reference schemas to cite

When the user's project domain matches, cite by name in the Researcher brief:

- **Marketplace / e-commerce** -> Shopify Storefront API (cart, checkout, products, customer)
- **Issue tracker / project management** -> Linear API (Issue, Project, Cycle, Comment)
- **Code hosting / SCM** -> GitHub GraphQL API (Repository, PullRequest, Issue, viewer)
- **Headless CMS** -> Contentful, Hygraph (content models, locales, asset types)
- **Payments (preview)** -> Stripe GraphQL API patterns
- **Generic CRUD-over-Postgres** -> Hasura's auto-generated schemas (insert/update/delete by PK, where clauses)

## Code-first schema authoring (Pothos)

The atlas-graphql-yoga template uses **Pothos 4.x code-first SchemaBuilder**. The Researcher should sketch the schema in Pothos idioms so the Developer's diff is mechanical:

- `builder.queryType({ fields: (t) => ({...}) })` for the root Query.
- `builder.mutationType({ fields: (t) => ({...}) })` for mutations; each mutation takes a single `input: <Name>Input!` arg via `builder.inputType(...)` and returns a payload via `builder.objectType(...)` with both the entity and `userErrors`.
- `builder.objectRef<TypeShape>("Name").implement({ fields: (t) => ({...}) })` for object types.
- `builder.enumType(...)` for enums (status codes, error codes).
- For DB-backed resolvers, cite the Pothos Drizzle plugin's `t.relation()` and `t.field({ type: ... })` patterns; otherwise plain `resolve` functions.

## Output style

The Researcher brief should:
1. Open with the chosen reference schema(s) and one paragraph of WHY (2-3 sentences max).
2. List 5-8 root Query fields for the user's domain, naming the return type as a `Connection` or specific object.
3. List 3-5 mutations with their `input` shapes and `userErrors` codes.
4. Note any subscription opportunities ("real-time order status" -> `subscription orderStatusUpdated(orderId: ID!): OrderStatusEvent!`).
5. Close with auth scheme + multi-tenancy approach.
