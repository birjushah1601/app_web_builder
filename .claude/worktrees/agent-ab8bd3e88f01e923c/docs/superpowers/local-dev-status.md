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
- **Plan L: developer fix-loop on gate failure.** When `ATLAS_FF_AUTO_FIX_LOOP=true` AND a Plan I gate (security or a11y) fails, the engine emits `ritual.escalation_requested` (Plan I behavior preserved) AND auto-triggers an internal `_runRitual()` with the failing gate's report folded into `PriorRitualContext` as a "## Gate findings" section. The architect sees the original plan + diff + the issues to fix; the developer regenerates a diff; the gates re-run. Capped at 2 attempts per ritual lineage via `MAX_FIX_ATTEMPTS`. New events emitted: `auto_fix.attempted`, `auto_fix.budget_exhausted`, `auto_fix.failed`. ChatPanel renders an "(auto-fix #N)" badge on fix-attempt rituals. Flag-OFF: Plan I's escalate-and-stop preserved; no auto-retry.
- **Plan P: streaming live progress.** When `ATLAS_LIVE_EVENTS=true` (Plan E.0 broker is on), the rail's `<RitualTimeline />` now renders 5 phase rows (Architect, Developer, Sandbox, Security gate, Accessibility gate) instead of 3. Gate rows hide when their phase didn't run (flag-OFF for security/a11y looks identical to before). Plan L's auto-fix events surface as a dedicated indicator: "Auto-fix #1 in progress…" → "Auto-fix budget reached (2 attempts)" or "Auto-fix failed: \<error\>". Backed by an extended `RitualEventType` union, `factory.ts → mapCheckpointToRitualType` forwarding security/a11y/auto_fix events to the broker, an extended `timelineReducer` with `autoFixAttempts` + `autoFixExhausted` fields, and a hydrator extension folding `auto_fix.attempted` into `fixAttempts` so process restart still recovers the state. No new flag — piggybacks on `ATLAS_LIVE_EVENTS`.
- **Plan S.1: Sandbox Uplift.** The `atlas-next-ts` E2B template image (v0.2+) ships Tailwind 3 + shadcn/ui (11 primitives at `@/components/ui/*`) + lucide-react + framer-motion + atlas-* CSS-variable design tokens. The Developer role's `SANDBOX_CONTEXT_PROMPT` now enumerates these as available rather than forbidden. Republish via `packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh` after pulling this change. Existing flag-OFF developer outputs (inline-style React) still work — the change is forward-compatible.
- **Plan S.2: Researcher role + reference catalog.** When `ATLAS_FF_RESEARCHER=true`, `getResearcherRole()` instantiates `ResearcherRole` from `@atlas/role-researcher`. Catalog-only by default (30 hand-curated category YAMLs in `packages/role-researcher/catalog/`). When `ATLAS_RESEARCH_WEB=true` AND `BRAVE_SEARCH_API_KEY` is set, attaches `BraveSearchAdapter` for live web search per ritual. Fast-mode short-circuit (constructor `mode: "fast"`) skips the LLM call and returns mechanical brief from top-3 local references. Not yet dispatched by the engine — that wiring lands in Plan S.4. Until then, the role is constructable + tested but inert.
- **Plan S.3: Designer role + A2UI primitive.** When `ATLAS_FF_DESIGNER=true`, `getDesignerRole()` instantiates `DesignerRole` from `@atlas/role-designer`. Consumes architect's artifact + S.2's optional `InspirationBrief`, emits a Sonnet `DesignProposal { recommended, alternates: [DesignDirection, DesignDirection], reasoning }`. Pure `refineAxis` helper for axis-by-axis refinement (no LLM). atlas-web `components/a2ui/` ships four reusable React components: `OptionsCard` (Pattern C), `AxisWizard` (Pattern B with educational tooltips), `OutcomeCard` (ama-tier), `TechnicalCard` (diego/priya-tier). Not yet rendered anywhere — Plan S.4 wires them into `<DesignerCanvas>`.
- **Plan S.4 (atlas-web shell): Canvas v1 + per-mode renderers.** When `ATLAS_FF_CANVAS_V1=true`, the projects/`[id]`/canvas page replaces its preview-only right pane with `<CanvasShell>` (`apps/atlas-web/components/canvas/CanvasShell.tsx`). The shell consumes a `CanvasManifest` from `@atlas/canvas-runtime`, narrows modes via `personaFilter()`, renders a top-right `<ModeToggle>` segmented control, and looks up the active mode's renderer in the process-wide `canvasModeRegistry` singleton (populated by `register-renderers.tsx` at module load). v1 ships three renderers: `<DesignerCanvas>` (wraps S.3 `<OptionsCard>`), `<RefineWizard>` (wraps S.3 `<AxisWizard>` with palette/typography/density axes), and `<PreviewCanvas>` (re-export of today's `<CanvasPreviewClient>`). The `useCanvasState` hook subscribes to `EventSourceProvider` and auto-switches modes on `canvas.options.requested` (→ designing) and `sandbox.apply.completed` (→ preview); manual `setActiveMode` overrides are sticky for the hook's lifetime. No manifest source is wired in this commit — `<CanvasShell manifest={undefined}>` falls back to `<EmptyCanvas>` until the engine-integration plan ships the manifest. Flag-OFF preserves Plan R's preview-only canvas tree byte-for-byte (`canvas-flag-off.test.tsx` locks the contract).
- **Plan S.5 (atlas-web wiring): Visual-Quality merge gate.** When `ATLAS_FF_VISUAL_QUALITY_GATE=true`, `getRitualEngine()` constructs `VisualQualityRole` from `@atlas/gate-visual-quality` and appends `"visual-quality"` to `postDeveloperChain` after Security and A11y. The role uses a lazy `SandboxExec` adapter that connects to the live E2B sandbox per `runCommand` call (avoids stale handle issues), a previewUrl resolved from `getSandboxFactory().getOrProvision(projectId)`, and a Sonnet-class multimodal model (override via `ATLAS_VQ_GATE_MODEL`). `getVisualQualityRole({exec, previewUrl})` is also exposed in `lib/llm/factory.ts` mirroring `getResearcherRole`/`getDesignerRole` for in-isolation construction. The broker's `RitualEventType` union extends with six new types — `visual_quality.{started,passed,failed,skipped,completed,errored}` — and `mapCheckpointToBrokerEvent` forwards each so the rail timeline can render a visual-quality row alongside security + accessibility. Flag-OFF = chain unchanged.
- **Plan T.1 + T.2.x: Multi-stack templates (full coverage).** When `ATLAS_FF_MULTI_STACK=true`, the sandbox factory routes by architect-classified `artifactKind`: `frontend-app` → `atlas-next-ts-v2`, `backend-rest-api` → `atlas-fastapi` (Python+FastAPI), `backend-graphql` → `atlas-graphql-yoga` (Bun + GraphQL Yoga + Pothos), `data-pipeline` → `atlas-dlt-python` (dlt + DuckDB + dbt + small FastAPI status app), `mobile-app` → `atlas-expo-rn` (Expo SDK 52 + RN 0.76 + NativeWind; preview iframe shows `expo start --web`), `cli-tool` → `atlas-bun-cli` (Bun + Commander + ink; CLI exercised via E2B Exec, status page on port 3000). Alternate `backend-rest-api` stack `atlas-hono-bun` (Bun + Hono + Drizzle) opts in per-project via `ATLAS_DEFAULT_SANDBOX_TEMPLATE`. Per-template `SANDBOX_CONTEXT_PROMPT` registry in `@atlas/role-developer` swaps the prompt fragment by template name. ResearcherRole composes per-`artifactKind` skill (one md file per kind in `packages/skill-library/skills/researcher/`). Per-project `ATLAS_DEFAULT_SANDBOX_TEMPLATE` env always wins. **Operator post-merge step:** republish each new template via its `scripts/build-template.sh`, then commit the printed `template_id` to its `e2b.toml`.

## What's NOT wired (deferred)

- **Streaming progress.** Send button stays disabled for the whole 45–60s; user can't see "architect running" → "developer running" in real time.
- **Dynamic UI for blocking questions** (architect.triage.needs_input). Today they render as a bullet list; agent could emit a structured form (RJSF / AG-UI / Anthropic tool-use → React form). Research note in `docs/superpowers/research/a2ui-2026-04-27.md` (TBD if formalized).
- **Reviewer-as-Role extraction.** DeveloperRole still invokes `reviewerVote` inline; promoting Reviewer to a Conductor role is deferred to a follow-up plan. Ship role still unregistered in the factory.

## How to enable each plan locally

Every plan ships flag-OFF by default. Add the flag(s) to `apps/atlas-web/.env.local` and restart `pnpm dev`. Full env-var reference (with comments + defaults): `apps/atlas-web/.env.example`.

| Plan | Flag(s) | Extra env required | What turns on |
|---|---|---|---|
| **E.0 / G / F** | `ATLAS_LIVE_EVENTS=true` | — | SSE event broker, persistent left-rail (ChatPanel + RitualTimeline), preview iframe auto-reload on diff apply |
| **H** | `ATLAS_RITUAL_HYDRATION=true` | — | `engine.getRitual()` falls back to Postgres replay on in-memory miss; restart no longer drops history |
| **I** Security | `ATLAS_FF_SECURITY_ROLE=true` | — | After developer dispatch, dispatches `SecurityRole`; failing gate escalates ritual |
| **I** Accessibility | `ATLAS_FF_A11Y_ROLE=true` | — | Same shape, `AccessibilityRole` |
| **J** | `ATLAS_FF_RUN_GRAFANA=true` | `ATLAS_GRAFANA_URL` + `ATLAS_GRAFANA_TOKEN` | Run page replaces "unknown" placeholder with real `computeHealthSummary` query. Missing env = stays on placeholder, no crash. |
| **K** | `ATLAS_FF_MULTI_TURN=true` | — | "Refine" textarea under each developer-output card; refinement runs as a child ritual linked to the parent via `parentRitualId` |
| **L** | `ATLAS_FF_AUTO_FIX_LOOP=true` | requires `ATLAS_FF_SECURITY_ROLE` and/or `ATLAS_FF_A11Y_ROLE` (something has to fail to trigger the loop) | When a chained gate fails, engine auto-runs a fix-attempt ritual with the report folded into the architect prompt as "## Gate findings". Up to 2 attempts. |
| **P** | piggybacks on `ATLAS_LIVE_EVENTS=true` | none new | Rail's `<RitualTimeline />` shows 5 rows (Architect, Developer, Sandbox, Security gate, Accessibility gate) — gate rows hidden when not running. Auto-fix indicator surfaces "Auto-fix #N in progress…" / "budget reached" inline. |
| **S.2** | `ATLAS_FF_RESEARCHER=true` | optional `ATLAS_RESEARCH_WEB=true` + `BRAVE_SEARCH_API_KEY` | Constructs ResearcherRole. Inert until S.4 wires it into the engine. |
| **S.3** | `ATLAS_FF_DESIGNER=true` | — | Constructs DesignerRole. Inert until S.4 wires it. A2UI primitives are import-ready. |
| **S.4** (atlas-web shell) | `ATLAS_FF_CANVAS_V1=true` | — | projects/`[id]`/canvas right pane swaps preview-only canvas for polymorphic `<CanvasShell>` (mode toggle + persona filter + DesignerCanvas / RefineWizard / PreviewCanvas renderers). With no manifest yet wired, the shell renders `<EmptyCanvas>` until the engine-integration plan emits one. Flag-OFF = Plan R preview-only tree byte-for-byte. |
| **S.5** (atlas-web wiring) | `ATLAS_FF_VISUAL_QUALITY_GATE=true` | optional `ATLAS_VQ_GATE_MODEL` (Sonnet-class default) | After developer dispatch + security + a11y, dispatches `VisualQualityRole` (L7 visual-advisory gate). Lazy E2B exec + previewUrl. `visual_quality.*` events flow through the broker for the rail timeline. Failing gate folds report into the Plan L auto-fix loop when both flags are on. |
| **T.1** | `ATLAS_FF_MULTI_STACK=true` | E2B credentials for republish; `atlas-fastapi` template must be live in your E2B account | Architect's `artifactKind` routes sandbox provisioning. Backend-REST-API projects get a real FastAPI sandbox instead of Next.js. |

Flag combinations are independent — turn on whichever subset is useful for the demo. The flags interact cleanly: e.g. `ATLAS_LIVE_EVENTS=true` + `ATLAS_FF_MULTI_TURN=true` puts the persistent rail's chat into refinement mode; add `ATLAS_RITUAL_HYDRATION=true` and the refinement chain survives `pnpm dev` restarts.

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
