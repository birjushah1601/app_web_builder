# Next session — start here

> One-page handoff. Read this in 60 seconds; pick the first action; go.
> Deep context in `current-state-2026-05-20.md` if you want it.

## Where we are (one sentence)

Plan L0 (build gate) is merged to main behind a flag-off; the website ritual chain works end-to-end but has 3 known bugs and ~9-minute latency that need attention before adding scope.

## What got shipped 2026-05-15 → 2026-05-20

- **Plan L0 build gate** (PR #1, merge commit `b56a871`): `@atlas/gate-build` package + ritual-engine integration + architect prompt extension + atlas-web factory wiring. Catches uncompilable code via per-template `tsc --noEmit` / `pyright`. Flag-OFF by default; enable via `ATLAS_FF_BUILD_GATE=true`.
- **Hybrid Claude proxy + OpenRouter routing**: `apps/atlas-web/lib/engine/routing-provider.ts`. Claude calls hit local proxy `:3456` (free); other models go through OpenRouter.
- **Canvas ModeToggle always visible** (`9580d89`): no more `?canvas-modes=show` gate; user always has manual escape hatch when SSE auto-switch misfires.
- **SSE broker forwards triage + build-gate events** (`ceacaaa`): architect rail row no longer spins forever on triage pause; question card renders correctly.

## Three bugs in priority order — do these first

### 1. D16 — Designer schema rejects empty `serifFamily` (~5 min, biggest latency win)

File: `packages/role-designer/src/types.ts`
Change: `serifFamily: z.string().min(1)` → `serifFamily: z.string().optional()` (and same for `monoFamily`)
Impact: removes ~30% of designer retries, saves 60-90s per affected ritual.

### 2. D14 — Diff-parser writes next file's header into previous file's content (~1-2 hrs)

File: `apps/atlas-web/lib/sandbox/apply-diff.ts` — `repairCreateHunkCounts` and/or `collectAddedLines`.
Symptom: sandbox compile fails with `Expected ';', '}' or <eof>`. Captured 2026-05-20 on Saffron Table ritual — `layout.tsx` content ended with `}\ndiff --git a/src/app/globals.css...`.
Approach: next ritual that fails this way, capture the raw diff string from the developer's RoleOutput. Write a unit test. Fix the chunk-boundary detection. The CHUNK_END_RE regex in `repairCreateHunkCounts` exists; verify it correctly stops at the NEXT file's `diff --git` header.

### 3. D15 — Flip `ATLAS_FF_BUILD_GATE=true` in `.env.local` (~30 sec, do AFTER D14)

The build-gate work is dormant until the flag is on. Flip after D14 lands so the auto-fix loop doesn't waste attempts retrying broken diffs the model didn't actually write incorrectly.

## After those three: D17 (canvas hydration) + D18 (perf)

- **D17**: server-side fetch latest events from `SpecEventRepo` and pass as `initialEvents` to `<EventSourceProvider>`. Cures every "I don't see the X" report at the root.
- **D18**: top wins are (a) pre-warm sandbox on project creation, (b) swap designer-revise from Sonnet → Haiku, (c) move repo from `/mnt/f/` to native Linux filesystem. Full list in `known-deferrals.md` D18.

## Performance baseline (2026-05-20, Postgres-measured)

End-to-end ~9 min engine work per ritual:
- Architect: 5-16s ✓
- Researcher + Designer 3-pass: 150-220s (doubles on D16 retry)
- Asset gen + Developer + sandbox cold-start: 230-300s
- Sandbox file write: 9-12s ✓
- Security gate + finalize: 3s ✓

## Start-of-session checklist

```bash
# 1. Confirm clean main
git pull origin main

# 2. Bring up infra
docker compose up -d postgres
# (Claude Code CLI proxy on :3456 — run in your own terminal)

# 3. Dev server (Turbopack only — webpack first-compile is 10-17 min on WSL)
cd apps/atlas-web && pnpm exec next dev --turbo

# 4. Read these three files (in this order):
#    - docs/superpowers/NEXT-SESSION.md     (this file)
#    - docs/superpowers/known-deferrals.md  (D14-D18 detail)
#    - docs/superpowers/current-state-2026-05-20.md  (deep snapshot)

# 5. Pick D16 as your first action.
```

## When asking Claude for help in the next session

Paste this into the first message:

> I'm continuing work on the Atlas repo at /mnt/f/claude/ai_builder (pnpm monorepo, Node 22). Read `docs/superpowers/NEXT-SESSION.md` first — it's a one-page handoff for where I am. The previous session merged Plan L0 (build gate) to main; the three open bugs are D14 (diff parser), D15 (flag flip), and D16 (designer schema retry). I want to start by fixing D16 — change `serifFamily: z.string().min(1)` to optional in `packages/role-designer/src/types.ts`, run the role-designer tests, commit. Then we'll tackle D14.

That message + this doc are enough to start cold. No re-reading the whole session.

## What's NOT in scope for next session

- App development (mobile-app via `atlas-expo-rn`, etc.) — templates exist but unvalidated. Tackle AFTER website chain is stable.
- Production deploy pipeline — `packages/deploy-orchestrator` exists but no end-to-end. Phase C-1.
- Native iOS/Android — Phase D or later, only if Expo's web+native story doesn't cover customers.

---

**File map (where to look for what):**

- Spec / plan / current-state docs: `docs/superpowers/`
- Build gate package: `packages/gate-build/`
- Ritual engine: `packages/ritual-engine/src/engine.ts`
- Architect prompt: `packages/role-architect/src/deep-plan.ts`
- Canvas shell + renderers: `apps/atlas-web/components/canvas/`
- Engine factory + SSE forwarding + LLM provider: `apps/atlas-web/lib/engine/factory.ts`, `apps/atlas-web/lib/llm/factory.ts`, `apps/atlas-web/lib/events/EventBroker.ts`
- Diff parser (D14 bug): `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Designer schema (D16 bug): `packages/role-designer/src/types.ts`
- Local env: `apps/atlas-web/.env.local`
