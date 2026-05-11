# Atlas Demo Runbook — "AI Builder in Action"

End-to-end walkthrough of what's live on `main` today (2026-04-29). Everything below ships behind feature flags; flag-OFF is byte-for-byte today's one-shot UX. Flag-ON is the full demo.

---

## TL;DR — minimum for a working demo

1. Postgres on `localhost:5440` (`docker compose up -d postgres`)
2. A local Claude proxy on `:3456` running (claude-max-api-proxy or equivalent)
3. `apps/atlas-web/.env.local` populated (see template below)
4. `cd apps/atlas-web && pnpm dev`
5. Open `http://localhost:3000/sign-in`, sign in, hit "New project", land on `/projects/<id>/canvas`
6. Type "build me a TODO app" → Send

You'll see the Architect plan, the Developer diff, the diff getting applied to the live E2B sandbox, and the preview iframe refreshing within a few seconds — all behind the same chat surface.

With **all flags on** (Plans G/H/I/J/K/L/P), you additionally get: persistent left-rail, live-streaming progress timeline, Security + Accessibility gates running automatically, auto-fix-on-gate-failure, refinement textarea, and persistent ritual history across `pnpm dev` restarts.

---

## `.env.local` template (copy to `apps/atlas-web/.env.local`)

The full reference with every flag + comment lives at `apps/atlas-web/.env.example`. The minimum set for a "wow" demo:

```bash
# ─── Auth ────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me

# ─── Database (already running via docker compose) ───────────────────────────
DATABASE_URL=postgres://atlas:atlas@localhost:5440/atlas_dev

# ─── LLM (local proxy) ───────────────────────────────────────────────────────
ATLAS_LLM_BASE_URL=http://127.0.0.1:3456
ATLAS_LLM_API_KEY=sk-no-auth
ATLAS_LLM_TRIAGE_MODEL=claude-haiku-4-5
ATLAS_LLM_DEEP_MODEL=claude-sonnet-4
# Recommended for single-provider proxies (avoids 5min timeout on big diffs):
ATLAS_LLM_DEVELOPER_MODEL=claude-haiku-4-5
ATLAS_DEVELOPER_SEQUENTIAL=true

# ─── E2B Sandbox (for live preview) ──────────────────────────────────────────
E2B_API_KEY=e2b_replace_me
E2B_TEMPLATE_NEXT_TS_DIGEST=sha256:replace_with_your_digest
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts
ATLAS_DEFAULT_SANDBOX_PORT=3000

# ─── Demo flags (all OFF by default — flip these on) ─────────────────────────
ATLAS_LIVE_EVENTS=true            # Plan E.0 + G + F + P: rail, live timeline, preview reload
ATLAS_RITUAL_HYDRATION=true       # Plan H: history survives pnpm dev restart
ATLAS_FF_SECURITY_ROLE=true       # Plan I: Security gate runs after every developer diff
ATLAS_FF_A11Y_ROLE=true           # Plan I: A11y gate runs after every developer diff
ATLAS_FF_MULTI_TURN=true          # Plan K: "Refine" textarea on each result
ATLAS_FF_AUTO_FIX_LOOP=true       # Plan L: auto-fix on gate failure (up to 2 attempts)
```

(`ATLAS_FF_RUN_GRAFANA` only matters if you have a real Grafana — leave off unless you do.)

---

## Step-by-step demo flow

### Setup (one-time per machine)

```bash
# 1. Bring up Postgres
docker compose up -d postgres

# 2. Apply DB migrations (first run only)
pnpm --filter @atlas/spec-graph-data db:migrate

# 3. Build all workspace packages (so atlas-web's dist resolutions work)
pnpm -r --filter "@atlas/*" build

# 4. Start the local Claude proxy in a separate terminal
#    (e.g. claude-max-api-proxy listening on :3456)

# 5. Start atlas-web
cd apps/atlas-web && pnpm dev
# → http://localhost:3000
```

### The demo (start to finish)

#### 0. Sign in + create project

- Visit `http://localhost:3000/sign-in`, sign in via Clerk dev tenant.
- Click "New project" on the projects index.
- Name it (e.g. "todo-demo"), click Create.
- You land on `/projects/<id>/canvas`.

**With `ATLAS_LIVE_EVENTS=true`:** the layout wraps in `<EventSourceProvider>` + a 360px persistent rail (left column). The rail header shows the projectId; the body has ChatPanel; the footer has the (initially empty) RitualTimeline.

#### 1. Submit a build request

In the rail's chat textarea: `"Build me a simple TODO app with add and delete"`. Click Send.

#### 2. Watch the live timeline (the "wow" moment)

The footer's `<RitualTimeline />` lights up, row-by-row, in real time:

```
●  Architect planning      [active] ━━━━━━ 4.2s
○  Developer writing       [pending]
○  Applying to sandbox     [pending]
```

Then:

```
✓  Architect planning      [done] 4.2s
●  Developer writing       [active] ━━━━━━━━ 18.9s
○  Applying to sandbox     [pending]
```

Then:

```
✓  Architect planning      [done] 4.2s
✓  Developer writing       [done] 22.7s   winner=anthropic
●  Applying to sandbox     [active] ━━━━ 2.1s
```

Then `sandbox.apply.completed` lands and the sandbox row turns green with `filesWritten=8`.

**With `ATLAS_FF_SECURITY_ROLE=true`:** a fourth row appears AFTER sandbox:

```
✓  Architect planning      [done]
✓  Developer writing       [done]
✓  Applying to sandbox     [done]
●  Security gate           [active] ━━━ 5.3s
```

Then the Security row resolves. If it passed, Accessibility runs next (when its flag is on too).

**With `ATLAS_FF_AUTO_FIX_LOOP=true` AND a gate fails:** an amber indicator appears under the rows:

```
✓  Architect planning      [done]
✓  Developer writing       [done]
✓  Applying to sandbox     [done]
✗  Security gate           [failed]   "Hardcoded API key in src/foo.ts"
─────────────────────────────────────────
⟳  Auto-fix #1 in progress…
─────────────────────────────────────────
```

The architect re-plans with the security findings folded in, the developer regenerates the diff, and the gates re-run. Up to 2 auto-fix attempts.

#### 3. Watch the preview iframe refresh

The `<HmrIframe />` in the canvas refreshes its `src` with `?atlas-reload=<eventId>` the moment `sandbox.apply.completed` fires (Plan F). User sees the live TODO app within 2-3 seconds of the diff applying.

#### 4. Refine the result

ChatPanel's developer-output card shows the diff + summary. With `ATLAS_FF_MULTI_TURN=true`, a "Refine" textarea appears beneath the card. Type:

> "Add a 'mark complete' button next to each todo"

Click Refine. A NEW ritual starts (linked to the parent via `parentRitualId`). The architect prompt is auto-prepended with a "Previous turn" section showing the prior plan + diff. The full architect → developer → sandbox → gates pipeline runs again. A second ritual card appears below the first, with the new diff + new preview iframe refresh.

#### 5. Restart the dev server, watch history persist

```bash
# Stop dev server (Ctrl+C), restart
cd apps/atlas-web && pnpm dev
```

Reload the browser page. With `ATLAS_RITUAL_HYDRATION=true`, the conversation history is recovered — both ritual cards still appear in ChatPanel, including the refinement chain.

---

## What's running under the hood

| User-visible | Engine internals | Plan |
|---|---|---|
| Persistent left-rail | `<RailShell />` mounted by `[projectId]/layout.tsx` | **G** |
| Live timeline rows | `EventSourceProvider` → SSE → `useTimelineState` → `<RitualTimeline />` | **E.0 + E + P** |
| Preview iframe auto-reload | `useReloadOnApplied` hook on `sandbox.apply.completed` | **F** |
| Architect + Developer chain | `RitualEngine.start` dispatches via Conductor | **B** (foundation) |
| Diff applied to sandbox | `SandboxApplier` writes via E2B SDK | **C** |
| Security + Accessibility gates | `postDeveloperChain` in factory | **I** |
| Auto-fix on gate failure | `_runRitual` recursion with `PriorRitualContext` + `securityReport` | **L** |
| Refinement loop | `engine.refine()` → child ritual + `PriorRitualContext` | **K** |
| History persists across restart | `SpecEventsHydrator` replays `spec_events` into `RitualSnapshot` | **H** |

---

## Troubleshooting

**Sign-in 500s →** Clerk keys missing or the test tenant changed. Confirm `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` are present.

**"No LLM provider configured" warning →** `ATLAS_LLM_BASE_URL` or `ANTHROPIC_API_KEY` must be set. The local proxy must be reachable (curl `http://127.0.0.1:3456/v1/models` should return).

**Sandbox row stays "active" forever →** `E2B_API_KEY` missing or template digest pinned to a removed version. Canvas shows a red "Preview unavailable" card with the cause.

**Timeline rows never appear / page errors with "Jest worker encountered…" →** Stale build artifact. Run `pnpm -r --filter "@atlas/*" build` then restart `pnpm dev`.

**Refine button disabled or 'multi-turn refinement is disabled' error →** `ATLAS_FF_MULTI_TURN=true` not set in `.env.local`, or dev server wasn't restarted after editing the file.

**Plan H restart-recovery doesn't work →** Hydrator only kicks in for in-memory misses. If your test ritual is still in the same process's `getRitualEngine` cache, hydrator never runs. Restart `pnpm dev` to force a cold cache.

---

## Plan-by-plan flag reference

See `docs/superpowers/local-dev-status.md` for the always-up-to-date version. Quick:

```
ATLAS_LIVE_EVENTS         — broker + rail + preview reload + live timeline (E.0/G/F/P)
ATLAS_RITUAL_HYDRATION    — restart-survival of ritual history (H)
ATLAS_FF_SECURITY_ROLE    — L4 security gate (I)
ATLAS_FF_A11Y_ROLE        — L5 accessibility gate (I)
ATLAS_FF_MULTI_TURN       — refinement textarea + child rituals (K)
ATLAS_FF_AUTO_FIX_LOOP    — auto-fix on gate failure (L)
ATLAS_FF_RUN_GRAFANA      — Run page → real Grafana (J — needs ops setup)
```

All default OFF. All independently flippable. Flag-OFF for any flag = pre-plan behavior preserved byte-for-byte.

---

## What's next (after the demo lands)

The biggest gaps from a pure demo perspective are no longer engineering — they're operator-side:

1. **Pin a working `E2B_TEMPLATE_NEXT_TS_DIGEST`** so users don't hit "template not found" on first use.
2. **Add a "starter prompts" suggestion list** under the chat textarea (e.g. "Build me a TODO app", "Generate a landing page for X", "Add a contact form to this") — pure UX, ~1 day.
3. **Onboarding tour** — first-time user clicks through the flag-on flow with a guided tooltip overlay. ~2 day plan.

Engineering follow-ups remain in `docs/superpowers/local-dev-status.md` "What's NOT wired (deferred)".
