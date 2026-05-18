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

## Code View (`/projects/[projectId]/code`)

> **Persona target:** Diego (developer) and Priya (architect + developer). The Canvas view (E.2) and the Code view share the same project; clicking an element in one view highlights it in the other (cross-view linking lands in E.2's dual-pane wiring).

### Layout

Three-pane shell:

```
┌─────────────────┬───────────────────────────────┬────────────────┐
│   File Tree     │       Monaco Editor            │  Right Pane    │
│   (FileTree +   │  (@monaco-editor/react,        │  Tab strip:    │
│   FileTree-     │   ssr: false, dark theme)      │  PR | Terminal │
│   Client)       │                                │  | Tests       │
└─────────────────┴───────────────────────────────┴────────────────┘
```

### File tree

Populated from `@atlas/spec-graph-sync`'s `listMirroredFiles({ projectId })`. The Server Component fetches the list at render time; `FileTreeClient` (Client Component) holds selected-file state. Clicking a file triggers the `openFile` Server Action which reads via `@atlas/spec-graph-sync` and returns the content + Monaco language hint.

### Monaco editor

Loaded via `next/dynamic` with `ssr: false`. On save:
1. `saveFile` Server Action writes through `@atlas/spec-graph-sync` (which updates the file mirror).
2. `editClassifier.ts` heuristic classifies the change as `"cosmetic"` or `"structural"`.
3. `RitualEngine.start({ editClass })` is called — cosmetic edits take the `visualize → build` fast path; structural edits take the full `visualize → agree → build` ritual (wired in E.4).

### PR pane

Uses `@octokit/rest` exclusively in Server Actions (token never reaches the browser):
- `listPrs` — list open/closed PRs for the project's GitHub repo.
- `openPr` — create a new PR. Stub note: E.3 ships only the API call; the `git push` that creates the branch on the remote is wired in **Plan E.4** (E2B sandbox).
- `getPrDiff` — fetch unified diff; rendered via Monaco `DiffEditor` in `PrDiffViewer`.
- `postPrComment` — post an issue comment on the PR.
- `mergePr` — squash/merge/rebase merge via `octokit.pulls.merge`.

Configure `GITHUB_TOKEN` in `.env.local`:
```env
GITHUB_TOKEN=ghp_your_token_here
```

### Terminal pane

Mounts `xterm.js` (also `ssr: false`). In **E.3** the backend is a stub that writes `"sandbox not connected yet (E.4)"` to the terminal. The real WebSocket bridge to the E2B sandbox lands in **Plan E.4**.

### Test runner pane

Displays `vitest` JSON results. In **E.3** the backend is a stub. Real results stream in from the E2B sandbox in **Plan E.4**.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | For PR flow | Personal access token or GitHub App installation token with `repo` scope |

All other env vars (database URL, Clerk keys, etc.) are inherited from the E.2 scaffold.

### Adding a new Server Action

1. Create `lib/actions/code/<name>.ts`.
2. Add `"use server"` at the top.
3. Call `auth()` from `@clerk/nextjs/server`; throw `"UNAUTHORIZED"` if no session.
4. Add a test in `test/actions/code/<name>.test.ts` that mocks all external calls.
5. Import and call from the Client Component (Next.js will automatically route the call through the Next.js server boundary).

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
