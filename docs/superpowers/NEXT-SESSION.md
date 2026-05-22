# Next session — start here

> One-page handoff. Read this in 60 seconds; pick the first action; go.
> Deep context in `current-state-2026-05-20.md` (Plan L0 merge snapshot) and `known-deferrals.md` (live tracker).

## Where we are (one sentence)

Plan L0 (build gate) is merged to main; 2026-05-21 session shipped 5 follow-up commits closing D16/D17/D18a/D18b cleanly and a defensive partial-fix for D14 — but **nothing has been executed against a real ritual yet**, and the build-gate flag is still OFF.

## What got shipped 2026-05-21

All on `plan-l0/build-gate` (+8 ahead of `origin`, **not pushed**):

| Commit | Item | Files | Status |
|---|---|---|---|
| `0f80daa` | **D16** designer schema relax + **D18b** revise model → Haiku | `packages/role-designer/{src/types.ts, src/role.ts, test/types.test.ts}` | Tests added; not executed |
| `31a7d5d` | **D17** server-fetch `initialEvents` into `<EventSourceProvider>` | `apps/atlas-web/lib/events/{EventSourceProvider.tsx, getInitialEventsForProject.ts*}`, `app/projects/[projectId]/layout.tsx`, test | Tests added; not executed |
| `79b3782` | **D18a** pre-warm sandbox on project creation (flag `ATLAS_FF_SANDBOX_PREWARM`, default OFF) | `apps/atlas-web/app/projects/new/actions.ts`, `lib/feature-flags.ts`, test | Tests added; not executed |
| `6cfdb6f` | **D14** apply-diff `CHUNK_END_RE` broadened with `+++`/`new file mode`/`deleted file mode`/`index` markers + synthetic regression test | `apps/atlas-web/lib/sandbox/apply-diff.ts`, `test/.../apply-diff-multi-file-leak.test.ts*` | **Defensive partial-fix only** — see caveat below |

`*` = new file.

## D14 caveat — read before flipping D15

The 2026-05-21 fix tightens chunk-boundary detection for the case where the LLM omits `diff --git` between files. **However, the captured Saffron Table symptom (2026-05-20) had `diff --git` *present* in the leaked content** — which the *original* regex already matched. So this fix probably resolves an adjacent variant, not the exact symptom captured. The actual root cause may sit in the `parse-diff` library's handling of malformed hunk counts (`@@ -0,0 +1,N @@` where N disagrees with the actual `+` count, even after our repair walker).

**Action for next session:** run one ritual end-to-end. If the leak does NOT recur → D14 is effectively closed and you can flip D15. If it DOES recur → this time, capture the **raw diff string** from the developer's `RoleOutput` (log it from `apps/atlas-web/lib/sandbox/apply-diff.ts:parseDiff` entry point) so we can debug from real data instead of synthesizing.

## Three actions in priority order

### 1. Verify in WSL (~10 min, no code change)

```bash
# Tests — couldn't run from Windows session, pnpm symlinks installed from WSL don't resolve on Windows-native node
pnpm --filter @atlas/role-designer test
pnpm --filter atlas-web test -- test/lib/events test/lib/sandbox test/app/projects/new
```

If anything's red, fix before proceeding.

### 2. Run one real ritual (~10 min)

Take any restaurant/marketing prompt, run end-to-end. Watch for:
- D16 verification: designer pass should no longer retry on empty `serifFamily` / `monoFamily`. Expect designer phase ≤ ~150s (was 150-220s with ~30% doubling to 300-400s).
- D18b verification: designer-revise leg should be measurably faster (Haiku vs Sonnet).
- D17 verification: refresh the canvas mid-ritual — events should already be present at hydration time, not arrive only via SSE.
- D14 verification: watch for any `}\ndiff --git` leak in sandbox file writes. If clean, mark D14 closed. If recurs, capture raw diff (see caveat above).

### 3. D15 flag flip (~30 sec, **only if step 2 was clean**)

In `apps/atlas-web/.env.local`:

```
ATLAS_FF_BUILD_GATE=true
```

Then run one more ritual to confirm the build gate engages without the auto-fix loop burning retries on D14-style false-positives.

## After the verification pass

- **D18c** — move repo from `/mnt/f/` to native Linux filesystem. 5-30× Turbopack compile speedup. User-only (I can't move files). Document the new path in `.env.local` examples after.
- **D18a flag flip** — once you've verified the path works end-to-end, set `ATLAS_FF_SANDBOX_PREWARM=true` in `.env.local`. The pre-warm has been designed flag-gated to allow a safe trial.

## Performance baseline (2026-05-20, pre-this-session)

Unchanged until step 2 actually runs:
- Architect: 5-16s ✓
- Researcher + Designer 3-pass: 150-220s (was doubling on D16 retry — should no longer)
- Asset gen + Developer + sandbox cold-start: 230-300s (D18a should shave the cold-start when flag is on)
- Sandbox file write: 9-12s ✓
- Security gate + finalize: 3s ✓

## Start-of-session checklist

```bash
git pull origin main          # confirm any merged work
git checkout plan-l0/build-gate
git status                    # confirm clean

# Bring up infra
docker compose up -d postgres

# Dev server (Turbopack only — webpack first-compile is 10-17 min on WSL/mnt-f)
cd apps/atlas-web && pnpm exec next dev --turbo
```

## File map (where to look for what)

- Spec / plan / current-state docs: `docs/superpowers/`
- Live deferral tracker: `docs/superpowers/known-deferrals.md`
- Build gate package: `packages/gate-build/`
- Ritual engine: `packages/ritual-engine/src/engine.ts`
- Architect prompt: `packages/role-architect/src/deep-plan.ts`
- Canvas shell + renderers: `apps/atlas-web/components/canvas/`
- Engine factory + SSE forwarding + LLM provider: `apps/atlas-web/lib/engine/factory.ts`, `apps/atlas-web/lib/llm/factory.ts`, `apps/atlas-web/lib/events/EventBroker.ts`
- Hydration loader (NEW): `apps/atlas-web/lib/events/getInitialEventsForProject.ts`
- Diff parser (D14): `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Designer schema (D16): `packages/role-designer/src/types.ts`
- Designer revise model (D18b): `packages/role-designer/src/role.ts:221`
- Pre-warm site (D18a): `apps/atlas-web/app/projects/new/actions.ts`
- Local env: `apps/atlas-web/.env.local`

## What's NOT in scope for next session

- App development (mobile-app via `atlas-expo-rn`, etc.) — templates exist but unvalidated. Tackle AFTER website chain is stable.
- Production deploy pipeline — `packages/deploy-orchestrator` exists but no end-to-end. Phase C-1.
- Native iOS/Android — Phase D or later.
