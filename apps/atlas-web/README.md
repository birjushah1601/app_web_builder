# atlas-web

Atlas's product surface — Next.js 15 App Router. Visualize → Agree → Build ritual UI for the three personas (Ama, Diego, Priya).

## Quickstart

```bash
# 1. Bring up Postgres (A.1's docker-compose)
pnpm db:up

# 2. Apply latest migrations (includes user_project_preferences)
pnpm -F @atlas/spec-graph-data migrate:up   # (or whatever A.1's helper is named)

# 3. Set Clerk + DB env
cp apps/atlas-web/.env.example apps/atlas-web/.env.local
# fill in Clerk publishable + secret keys from your dev dashboard

# 4. Dev server
pnpm -F atlas-web dev
```

Open http://localhost:3000. Sign up → land on the project list → "New project" → Canvas opens.

## Architecture

- **Server Components** own data fetching + Clerk auth gating.
- **Server Actions** (`lib/actions/*.ts`) wrap `@atlas/ritual-engine`. Browser code never imports the engine directly.
- **Client Components** (`components/*.tsx`) own interactivity — Canvas drag-rearrange, chat input, approval buttons.
- **Per-request cached `RitualEngine`** via React's `cache()` helper — multiple Server Actions in the same render share the same engine instance.

## Persona resolution

Two-layer:
1. Per-project override in `user_project_preferences` table (set via `setPersonaOverride` action).
2. Clerk user metadata `defaultPersona`.
3. Fallback: `ama` (least privileged).

The `<PersonaToggle>` writes to layer 1; layer 2 is set externally via Clerk dashboard or onboarding flow.

## Testing

```bash
pnpm -F atlas-web test           # vitest + jsdom + Testing Library
pnpm -F atlas-web typecheck
pnpm -F atlas-web lint
```

Component tests live under `test/components/`; Server Action tests under `test/actions/`. End-to-end Playwright tests land with Plan E.5.

## Env vars

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client SDK |
| `CLERK_SECRET_KEY` | Clerk server SDK |
| `DATABASE_URL` | Postgres for `@atlas/spec-graph-data` |

## What ships in E.2 vs later

| Feature | Plan |
|---|---|
| Next.js scaffold + Clerk + Tailwind | E.2 (this) |
| Canvas (React Flow) | E.2 |
| Persona toggle + override | E.2 |
| Server Actions: start / approve / accept-risk / escalate | E.2 |
| SSE events route (stub) | E.2 |
| Monaco editor + file tree + PR flow | E.3 |
| E2B sandbox + HMR iframe + multi-viewport preview | E.4 |
| Playwright e2e tests across personas | E.5 |
