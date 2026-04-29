# Atlas local dev — what's wired today

Quick reference for "what does the app actually do when I click Send?" Last updated **2026-04-27** with plan B close-out.

## End-to-end flow

```
ChatPanel.send (browser)
  → startRitual (Server Action)
    → getRitualEngine(projectId) [cached per-request via React cache()]
      → RitualEngine.start
        → Conductor.dispatch (architect, classified)
          → ArchitectRole.run
            → triage (Pass 1)   — emits architect.pass1.completed OR triage.needs_input
            → deepPlan (Pass 2) — emits architect.pass2.completed { artifact }
        → if artifact && editClass !== "cosmetic":
          → Conductor.dispatch (developer, forceRoleId + priorArtifact = artifact)
            → DeveloperRole.run
              → anthropicPass | googlePass (parallel OR sequential per env)
              → reviewerVote (picks winner)
              → emits developer.completed { summary }, returns diff: { kind: "patch", body }
      → snapshot { artifact, developerOutput, roleEvents }
    → returns StartRitualResult to ChatPanel
  → ChatPanel renders ArchitectPlanCard + DeveloperOutputCard
```

Total wall time: ~45–60 seconds (5 LLM hops through the local proxy).

## What's wired

- **Architect role** — triage (claude-haiku-4-5) + deep plan (claude-sonnet-4). Emits a scope-specific artifact (new-app, new-feature, bug-fix, etc.). Plan + blocking questions surface in ChatPanel.
- **Developer role** — anthropic pass + google pass + reviewer vote. Emits a unified diff + summary + filesModified list. Diff renders in ChatPanel as a collapsible `<details>`.
- **Cosmetic edit shortcut** — `editClass: "cosmetic"` skips the developer step (no diff generated).
- **Failure surfacing** — every layer catches and renders the cause:
  - LLM provider HTTP errors → `triage LLM call failed: <cause>` → red `role="alert"` in ChatPanel
  - Architect LLM failure → ritual still escalates with cause inline
  - Developer dispatch failure → red `developer-failed` panel; architect plan still shown
  - Sandbox provision failure → red "Preview unavailable" in canvas; rest of canvas works
- **Provider precedence** — `ATLAS_LLM_BASE_URL` (proxy) wins over `ANTHROPIC_API_KEY` (real API) when both set.
- **OpenAICompatProvider hardening** for proxies that strip the `tools[]` array (claude-max-api-proxy):
  - Schema injected into a system message so the model knows what JSON shape to emit
  - Required fields enumerated explicitly (top level + per discriminated-union variant)
  - JSON parsed from `content` as fallback when `tool_calls` is absent
  - Architect's `graphSlice` injected post-hoc (model not asked to echo)
  - Developer's `testsAdded` / `filesModified` defaulted post-hoc (`filesModified` recovered from diff headers)
- **Plan C: developer's diff applied to the live preview sandbox.** Every successful developer dispatch parses the diff via `parse-diff`, writes per-file via E2B SDK's `Sandbox.connect(sandboxId).files.*` to `/code/src/`, and Next.js HMR refreshes the iframe within ~3s. Per-file outcome rendered in ChatPanel as green/amber/red apply-status panel. `applyDiff` never throws — sandbox unavailable, hunk mismatch, path escape all become structured `FileApplyResult` entries.
- **Plan G: persistent left-rail chat shell.** When `ATLAS_LIVE_EVENTS=true`, `apps/atlas-web/app/projects/[projectId]/layout.tsx` wraps every project sub-route with `<EventSourceProvider>` + a 360px `<RailShell />` containing `<ChatPanel />` and the `<RitualTimelineSlot />`. Chat history + textarea state survive navigation between `/canvas`, `/code`, `/run`. Switching projects re-keys the rail (fresh React tree). Flag-OFF path is unchanged: `/canvas/page.tsx` mounts its own ChatPanel as before; layout passes `{children}` through with no wrapper.
- **Plan H: persistent ritual snapshots.** When `ATLAS_RITUAL_HYDRATION=true`, `RitualEngine.getRitual(ritualId)` (now async) falls back to a Postgres-backed `SpecEventsHydrator` on in-memory miss. Events landed by `SpecEventsSink` are folded back into a `RitualSnapshot` via the pure `replayEventsToSnapshot` in `@atlas/ritual-engine`. Process restart no longer drops history. Flag-OFF preserves today's in-memory-only behavior — no hydrator wired, miss returns undefined as before.
- **Plan I: Security + Accessibility roles registered.** When `ATLAS_FF_SECURITY_ROLE=true` and/or `ATLAS_FF_A11Y_ROLE=true`, `getRitualEngine()` instantiates `SecurityRole` (D.4) and/or `AccessibilityRole` (D.5) and appends them to a `postDeveloperChain`. After a successful developer dispatch with a real diff, the engine dispatches each chained role with the diff as `userTurn` and `developerOutput` as `priorArtifact`. A gate failure (`report.passed === false`) escalates the ritual via `ritual.escalation_requested` (gate `L4-security` / `L5-compliance`) and stops the chain. Reports surface in `RitualSnapshot.{securityReport, accessibilityReport}` and render in `ChatPanel` via `<SecurityReportPanel />` / `<AccessibilityReportPanel />`. Flag-OFF for both = today's architect → developer chain unchanged.
- **Plan J: Run-page Grafana wiring.** When `ATLAS_FF_RUN_GRAFANA=true` AND `ATLAS_GRAFANA_URL` + `ATLAS_GRAFANA_TOKEN` env are set, the Run page (`/projects/[projectId]/run`) replaces its hardcoded "unknown" `HealthSummary` placeholder with a real query through `HttpGrafanaClient` via `computeHealthSummary`. `computeHealthSummary` already wraps a try/catch returning "unknown" on Grafana failure, so an outage at runtime degrades exactly like flag-OFF. Endpoint stats + trace links remain empty arrays for v1 — `computeEndpointStats` takes pre-parsed metric maps (not a GrafanaClient), so wiring it requires multiple separate queries + parsing, deferred to a follow-up plan. Flag-OFF or missing env = today's placeholder unchanged.
- **Plan K: multi-turn ritual refinement.** When `ATLAS_FF_MULTI_TURN=true`, the developer-output card in ChatPanel shows a "Refine" textarea. Clicking Refine calls `RitualEngine.refine()` which starts a NEW ritual linked to the parent via `parentRitualId`; the architect's prompt prepends a "Previous turn" section (parent's plan + diff truncated to 8000 chars). The chain runs through the same architect → developer → security → a11y pipeline as the first turn. ChatPanel appends the child ritual to its history; the `/api/projects/[id]/ritual/[id]/thread` route walks the parent chain root → leaf for cross-page lineage queries. Cross-project denial returns 403. Flag-OFF: refineRitual Server Action throws; RefinementInputBar renders nothing; today's one-shot flow preserved.

## What's NOT wired (deferred)

- **Streaming progress.** Send button stays disabled for the whole 45–60s; user can't see "architect running" → "developer running" in real time.
- **Dynamic UI for blocking questions** (architect.triage.needs_input). Today they render as a bullet list; agent could emit a structured form (RJSF / AG-UI / Anthropic tool-use → React form). Research note in `docs/superpowers/research/a2ui-2026-04-27.md` (TBD if formalized).
- **Reviewer-as-Role extraction.** DeveloperRole still invokes `reviewerVote` inline; promoting Reviewer to a Conductor role is deferred to a follow-up plan. Ship role still unregistered in the factory.

## Running the stack locally

```bash
# 1. Postgres (atlas-postgres on host port 5440)
docker compose up -d postgres

# 2. Local Claude proxy on :3456 (claude-max-api-proxy or equivalent)
# — manage in a separate terminal; restart manually if it crashes

# 3. atlas-web
cd apps/atlas-web && pnpm dev
# → http://localhost:3000
```

## Required environment (`apps/atlas-web/.env.local`)

```
# Auth (Clerk dev keys)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Postgres
DATABASE_URL=postgres://atlas:atlas@localhost:5440/atlas_dev

# LLM provider (the local proxy)
ATLAS_LLM_BASE_URL=http://127.0.0.1:3456
ATLAS_LLM_API_KEY=sk-no-auth
ATLAS_LLM_TRIAGE_MODEL=claude-haiku-4-5
ATLAS_LLM_DEEP_MODEL=claude-sonnet-4

# Developer role: sequential ON for single-provider proxy setups
# (avoids hammering the proxy with concurrent tool-use requests)
ATLAS_DEVELOPER_SEQUENTIAL=true

# E2B sandbox for live preview
E2B_API_KEY=e2b_...
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts   # or any template you've built
ATLAS_DEFAULT_SANDBOX_PORT=3000
```

## Common failure modes + what to look for

| Symptom | Likely cause | What I see in dev log / UI |
|---|---|---|
| ChatPanel red alert: "fetch failed" | Proxy at :3456 is down | `ECONNREFUSED 127.0.0.1:3456` in stderr; restart proxy |
| ChatPanel red alert: "triage LLM call failed: HTTP 503" | Proxy alive but model returned non-2xx | `[conductor] role.failed` with the specific HTTP code |
| ChatPanel red alert: "...payload failed AmbiguityReportSchema" | Model output didn't match the schema | Look for the Zod issue list in the alert message |
| Canvas shows "Preview unavailable" | Sandbox provision failed | The error message in the panel tells you which (E2B key, spend cap, template not found) |
| `developer-failed` red card after architect plan | Developer chain failed; architect output preserved | `developer.dispatch.failed` event in roleEvents; check the cause string |

## Test surface (verifies the wiring without clicks)

- **`@atlas/ritual-engine`** — 49 tests. `engine-developer-chain.test.ts` simulates architect → developer with stubbed roles, covers all branch paths.
- **`@atlas/conductor`** — 32 tests. Includes back-compat case for the new `forceRoleId` opt-in.
- **`@atlas/role-developer`** — 30 tests. Includes parallelMode mode (3) and `withDefaults` (8) coverage.
- **`@atlas/role-architect`** — 30 tests. Includes the post-hoc graphSlice injection case.
- **`apps/atlas-web` vitest** — 198 tests across 41 files. ChatPanel rendering of architect + developer + failure cards; OpenAICompatProvider tool-use translation + content fallback; factory.ts provider precedence + DeveloperRole registration + env-driven parallelMode.
- **`apps/atlas-web` Playwright** — 3 auth-free smoke specs (`/sign-in` renders, `/` redirects, screenshot capture). Persona suite (10 specs) is aspirational — references UI test IDs that don't exist yet.
