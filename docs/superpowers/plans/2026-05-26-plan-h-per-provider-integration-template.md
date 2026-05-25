# Plan H+ — Per-Provider Integration Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a **repeatable template** that future implementation plans follow for adding any provider integration (Keycloak, Lago, MinIO, PostHog, Stripe, Plausible, Mailpit, etc.) to a specific Atlas template. Each provider × template combination becomes its own short plan; this meta-plan defines what's shared so they stay consistent.

**Why this is a template, not one plan:** there are dozens of (provider × template) combinations and they ship asynchronously based on user demand. Forcing them into one mega-plan would balloon scope. Instead each provider integration follows this same shape, so reviewers/implementers know what to expect.

**Spec reference:** Section 12 (DependencyProfile contract) + Section 1 (deferred: "per-provider integration code per template — each provider is a sub-plan").

**Depends on:** Plans A + B + C + D + (E and F if testing/deploying the provider).

---

## Plan filename convention

`docs/superpowers/plans/<date>-plan-h-<provider-slug>-into-<template-slug>.md`

Examples:
- `2026-06-XX-plan-h-keycloak-into-atlas-fastapi.md`
- `2026-06-XX-plan-h-keycloak-into-atlas-next-ts-v2.md`
- `2026-06-XX-plan-h-minio-into-atlas-next-ts-v2.md`
- `2026-06-XX-plan-h-lago-into-atlas-fastapi.md`

Each is a SHORT plan (~5–10 tasks). The template below is the boilerplate; the implementer fills in the provider-specific blanks.

---

## Provider plan template

Copy this when you start a new provider plan.

### Header
```
# Plan H — <Provider> integration into <Template> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Wire <Provider> into <Template> so workflows whose DependencyProfile picks <Provider> for <concern> produce generated apps that actually use <Provider> for that concern, including:
- Library/SDK install in package manifest
- Initialization code in the template's startup path
- Per-route middleware (auth) / per-page wrapper (analytics) / per-action call (payments) as appropriate
- envContract additions
- Profile compatibility entry in the template's supportedProviders manifest
- A smoke test verifying the integration works end-to-end

**Architecture:** Modify the <Template> sandbox-context developer prompt to know how to integrate <Provider>. Extend the template's `supportedProviders` manifest. If <Provider> needs a sidecar service in compose, add to the iac role's known-services catalogue.

**Spec reference:** Section 12 (DependencyProfile).

**Depends on:** Plans A + B + C + D.
```

### Standard task list

#### Task 1: Update template's supportedProviders manifest

Each Atlas template has (or gets) a `supportedProviders` manifest declaring which DependencyProfile choices it knows how to integrate. Lives at `packages/sandbox-e2b/templates/<template>/atlas-supported-providers.json`.

```json
{
  "auth": ["keycloak", "clerk", "better-auth", "lucia", "none"],
  "db": ["postgres", "none"],
  "storage": ["minio", "s3", "none"]
}
```

Add the new provider to the appropriate concern. Commit: `feat(<template>): declare <provider> support`.

#### Task 2: Extend developer prompt for the template

Modify the per-template developer prompt fragment (e.g., `packages/role-developer/src/sandbox-context-prompts/<template>.ts`) to include a section like:

```ts
const KEYCLOAK_AUTH_FRAGMENT = `When the DependencyProfile selects auth.provider="keycloak":
- Install the keycloak SDK: ${INSTALL_CMD}
- Initialize the Keycloak client in <init-file>
- Wrap protected routes with the Keycloak middleware
- Add these env vars to envContract:
  - KEYCLOAK_URL (required)
  - KEYCLOAK_REALM (required)
  - KEYCLOAK_CLIENT_ID (required)
  - KEYCLOAK_CLIENT_SECRET (required for confidential clients)
- Provide a /api/auth/login redirect handler
- Sample initialization code:
  <code snippet>`;
```

The developer role at runtime selects this fragment when `dependencyProfile.auth.provider === "keycloak"` and the template is the right one.

#### Task 3: If the provider needs a sidecar service, add to the iac role's catalogue

For services like Keycloak/MinIO/Postgres that need to run alongside the app:

Modify `packages/role-iac/src/known-services.ts` (or create if missing) to include a compose-service definition for the provider:

```ts
export const KEYCLOAK_COMPOSE_SERVICE = {
  image: "quay.io/keycloak/keycloak:26.0",
  ports: ["8080:8080"],
  environment: [
    "KEYCLOAK_ADMIN=admin",
    "KEYCLOAK_ADMIN_PASSWORD=admin",
    "KC_DB=postgres",
    "KC_DB_URL=jdbc:postgresql://postgres:5432/keycloak",
    "KC_DB_USERNAME=postgres",
    "KC_DB_PASSWORD=postgres"
  ],
  command: ["start-dev"],
  dependsOn: ["postgres"]
};
```

The iac role consults this catalogue when the DependencyProfile mentions the provider.

#### Task 4: envContract integration

Verify the workflow planner's prompt and the developer's prompt agree on the env var names per provider. Centralize in `packages/role-workflow-planner/src/provider-env-contracts.ts`:

```ts
export const PROVIDER_ENV_CONTRACTS: Record<string, Record<string, EnvVar[]>> = {
  auth: {
    keycloak: [
      { name: "KEYCLOAK_URL", required: true, description: "Base URL of the Keycloak realm" },
      // ...
    ],
    clerk: [/* ... */]
  }
};
```

So every plan that adds a provider also adds rows here. Workflow planner uses this when synthesizing the workflow's overall envContract.

#### Task 5: Tests

- Unit test on the template prompt fragment: stub LLM + assert the prompt includes the provider-specific instructions when profile selects this provider.
- Unit test on the iac role: assert when the profile selects the provider, the synthesized compose file contains the sidecar service.
- (Optional) integration test against a real e2b sandbox if the provider has trivial setup.

#### Task 6: Smoke spec

Write a Playwright spec under the template's e2e/ that, after a workflow run, verifies the provider integration works:
- For auth providers: signup flow → login flow → access protected route
- For payments: create checkout session → simulate success → verify webhook handled
- For analytics: trigger a page view → verify the event was recorded (or at least sent)

#### Task 7: Documentation

Update `apps/atlas-web/docs/dependency-providers.md` (create if missing) with a row for the provider × template: how it integrates, env vars, gotchas.

#### Task 8: Commit + ship

Each Task 1-7 has its own commit. Final commit chains everything.

---

## Ordering / priority recommendation

When adding providers in sequence, prioritize by user value:

1. **First wave (most-requested):**
   - `keycloak` into `atlas-fastapi`
   - `keycloak` into `atlas-next-ts-v2`
   - `postgres` (already foundational; verify it's complete)
   - `mailpit` into `atlas-fastapi` (dev-friendly default)

2. **Second wave (production necessities):**
   - `minio` into `atlas-next-ts-v2` (file uploads)
   - `lago` into `atlas-fastapi` (billing)
   - `glitchtip` into all templates (error tracking)
   - `unleash` into all templates (feature flags)

3. **Third wave (nice-to-have):**
   - `posthog` analytics
   - `meilisearch` search
   - `bullmq` jobs
   - Premium fallbacks (clerk, stripe, sentry, etc. — these are escape hatches for users who already use them)

Each (provider × template) gets its own short plan; the goal is incremental shipping based on real user demand.

---

## Plan H+ — Self-check
- [ ] Spec section 12 (per-template binding via supportedProviders manifest) → Task 1
- [ ] Spec section 12 (developer integration code per provider) → Tasks 2, 3, 4
- [ ] Spec section 12 (each provider integration is its own plan) → THIS TEMPLATE is the meta-plan

**Shippable result:** every provider plan that follows this template adds one (provider × template) integration in a few days. Users with specific stack preferences can get fast Atlas support without us boil-the-oceaning all providers up front.
