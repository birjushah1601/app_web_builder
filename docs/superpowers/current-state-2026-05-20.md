# Atlas current state — snapshot 2026-05-20

Point-in-time snapshot after the long Plan L0 build-gate session. Captures what's accomplished + what's the next priority + observed performance baseline. Read this first when picking up the work; pair with `local-dev-status.md` (what's wired) and `known-deferrals.md` (deferred items D1–D18).

---

## Accomplished this session (2026-05-15 → 2026-05-20)

### Plan L0 — Build Gate (merged 2026-05-20, PR #1)

19-commit feature branch, merged to main via merge commit `b56a871`. New `@atlas/gate-build` package + ritual-engine integration + architect deep-plan extension + atlas-web factory wiring. Behind `ATLAS_FF_BUILD_GATE` flag. Default OFF in code.

**Spec:** `docs/superpowers/specs/2026-05-15-build-gate-design.md`
**Plan:** `docs/superpowers/plans/2026-05-15-build-gate-l0.md`

What it does: after `sandbox.apply.completed`, runs the per-template compiler (tsc for TS templates, pyright for Python) inside the sandbox via E2B exec. On non-zero exit, emits a structured `BuildReport` with `errorKind` ∈ {compile, type, timeout, sandbox_unreachable, unsupported_stack} + `errors[]` (file:line:col:message). Engine treats it like security/a11y, escalates via Plan L auto-fix (up to 2 retries) with the structured errors threaded into the architect's `priorArtifact.parentBuildReport`. The architect's deep-plan prompt renders `## Build errors (compiler is authoritative — fix exactly these)` BEFORE `## Gate findings` when parentBuildReport is set; the existing fix-mode bypass also recognizes parentBuildReport and synthesizes a deterministic bug-fix artifact (no LLM call) framed as a compile failure.

**Tests:** 31 in `@atlas/gate-build` (schema, parsers, registry completeness, role behavior); ritual-engine 137/137 still green; role-architect 63/64 (1 pre-existing observability fail unrelated to this work).

**Smoke-verified:** end-to-end chain runs with flag ON (engine dispatches → role fires → events flow → engine recognizes failure → auto-fix engages); also smoke-verified that flag-OFF preserves today's chain byte-for-byte.

### Hybrid Claude / OpenRouter LLM routing (`5b97516`-ancestor commits)

`apps/atlas-web/lib/engine/routing-provider.ts` wraps two `OpenAICompatProvider` instances. Routes `anthropic/*` and bare `claude-*` model IDs to a local Claude Code CLI proxy (`ATLAS_LLM_CLAUDE_BASE_URL=http://127.0.0.1:3456`) and rewrites them to the proxy's native IDs (`anthropic/claude-sonnet-4.5` → `claude-sonnet-4`). Everything else (Gemini, Llama, etc.) keeps using OpenRouter via `ATLAS_LLM_BASE_URL`. Backward-compatible: when `ATLAS_LLM_CLAUDE_BASE_URL` is unset, behaves identically to single-provider config. Earlier session note "claude-max-api-proxy doesn't preserve tool_use" (2026-04-29) is **stale** — the local proxy now correctly preserves tool_use; verified by Designer 3-pass + Developer + Security gate all running through the local proxy without `[openai-compat-provider]` content-fallback warnings.

### Canvas ModeToggle always-visible fix (`9580d89`)

`apps/atlas-web/components/canvas/CanvasShell.tsx` no longer gates the manifest-mode toggle (designing | preview) behind `?canvas-modes=show`. The toggle renders whenever modes exist. Also restructured the shell so the container always renders; only the inner content swaps between EmptyCanvas (no manifest) and the active renderer. Closes the long-debugging arc "canvas is blank / I can't see the 3 options" — the manual toggle is the recovery path when the EventSource-driven auto-switch fails (which it does routinely on reconnect / hydration race).

### SSE forwarding additions (in PR + commit `ceacaaa`)

`mapCheckpointToBrokerEvent` (in `apps/atlas-web/lib/engine/factory.ts`) now forwards:
- `architect.pass1.completed{passed:false}` → `role.completed` (architect rail row's spinner terminates on triage pause)
- `architect.triage.needs_input` → passthrough (the existing question card in ChatPanel can render the question)
- `build-gate.{started,passed,failed,completed}` → passthrough (rail timeline can show a build-gate row)

`RitualEventType` union and its type-level test updated to match.

### Tangential restore — canvas keepalive + image-replace rollback

Commit `44f2871` (mid-PR) recovered 17K files lost by an earlier subagent's broad `git add`. That restore captured some canvas improvements that were on disk pre-session but not on main: `use-sandbox-keepalive.ts` (new — pings preview URL every 90s while tab visible), `CanvasPreviewClient.tsx` (threads iframeRef, adds image-replace patch rollback), `ImageReplacePopover.tsx` (anchor positioning). These ride along in the PR; they're verified internally consistent.

### Docs

This file, plus updates to:
- `docs/superpowers/local-dev-status.md` (Plan L0 + canvas-toggle entries, "what's wired" up to 2026-05-20)
- `docs/superpowers/known-deferrals.md` (D14–D18, all the items below)

---

## Open bugs (in priority order, see `known-deferrals.md` for full detail)

### D14 (highest priority): Diff-parser writes next file's header into previous file's content

`apps/atlas-web/lib/sandbox/apply-diff.ts` — when the developer emits a multi-file diff, the parser sometimes writes the literal `diff --git a/<next-file>` header as content of the PREVIOUS file. Symptom: sandbox compile fails with `Expected ';', '}' or <eof>`. Captured 2026-05-20 on Saffron Table. **Block at the root cause, not just the symptom.** Plan L0 catches the symptom via tsc but auto-fix can't recover because the model didn't write the broken code.

### D15: Build gate flag is OFF in `.env.local`

Plan L0 work is merged but dormant until you flip `ATLAS_FF_BUILD_GATE=true`. Pair with D14 fix — turn the gate on once the diff-parser stops producing pathological inputs, then re-run a full end-to-end smoke.

### D16: Designer schema rejects empty `serifFamily`

`packages/role-designer/src/types.ts`: `serifFamily: z.string().min(1)` → `.optional()`. ~30% of rituals retry the designer 3-pass because the model emits empty serif for sans-only designs. ~5-line fix saves 60-90s per affected ritual.

### D17: Canvas hooks miss SSE events on reconnect

`useCanvasManifest` / `useDesignerProposal` read from EventSource state, which loses events on reconnect or hydration race. Root fix: have the canvas page's server component pre-fetch latest events from `SpecEventRepo` and pass them as `initialEvents` to `<EventSourceProvider>`. Workaround in place via D14's ModeToggle fix; full fix is the next canvas workstream priority.

### D18: Performance hotspots — designer 3-pass + sandbox provisioning

End-to-end ~9 min per ritual (engine work only) per 2026-05-20 Postgres-measured timings. Top wins: pre-warm sandbox on project creation, swap designer-revise from Sonnet → Haiku, move repo from `/mnt/f/` to native Linux filesystem. Full breakdown in known-deferrals.md.

---

## Performance baseline (Postgres-measured, 2026-05-20)

3 rituals across the day:

| Step | Time spent | Notes |
|---|---|---|
| ritual.started → architect.canvas_manifest.emitted | **5-16s** | Architect triage + deep plan — fast |
| → canvas.options.requested | **150-220s** | Researcher + Designer 3-pass; doubles to 300-400s on D16 schema retry |
| → canvas.option.selected | **~315s** | USER click latency, not engine |
| → sandbox.apply.started | **230-300s** | Asset gen + Developer (anthropic + google + reviewer) + sandbox cold-start (60-300s of that) |
| → sandbox.apply.completed | **9-12s** | File writes via E2B SDK |
| → ritual.artifact_emitted | **3s** | Security gate (Haiku) + finalize |

**Total engine work: ~9 minutes per ritual.** Two dominant phases: designer-3-pass (3-4 min when retrying), developer-plus-sandbox (4-5 min when sandbox cold-starts).

---

## Suggested next-session sequence

**First 90 min:**
1. Fix D16 (designer schema) — 5 lines, removes the most common cause of ritual latency variability.
2. Fix D14 (diff-parser) — captured broken diff for a regression test, then fix `collectAddedLines` or `repairCreateHunkCounts`.
3. Flip `ATLAS_FF_BUILD_GATE=true` in `.env.local` (D15) and run a clean smoke to verify end-to-end with the gate on.

**Next 2-4 hrs:**
4. Fix D17 (canvas hydration) so the React UI is dependable across reconnects / refreshes.

**Then:**
5. Tackle D18 (perf workstream). Single biggest single-action win is the WSL filesystem move — Turbopack compile times go from 30-60s to 1-3s per route, which cascades into every smoke iteration being dramatically faster.

**Then (separate workstream):**
6. Validate multi-stack rituals end-to-end (mobile via `atlas-expo-rn`, backend via `atlas-fastapi`, etc.). All templates already exist (Plan T); they need smoke validation now that the website pipeline is stable.
7. Production deploy pipeline (per Phase C-1 / ADR-001 §K8s).

---

## What's broken vs what's working — one-glance

| Surface | State |
|---|---|
| Website ritual chain (architect → researcher → designer → asset-gen → developer → sandbox.apply → security → artifact) | ✅ Functional, slow (~9 min), occasionally produces broken file content (D14) |
| Build gate L0 (catch uncompilable code) | ✅ Merged + tested; flag OFF locally pending D14/D15 |
| Hybrid Claude proxy / OpenRouter routing | ✅ Verified end-to-end with tool_use through local proxy |
| Canvas UI — 3 design-direction cards | ⚠️ Renders when EventSource delivers `canvas.options.requested`; fragile on reconnect (D17). Manual ModeToggle is recovery (now always visible). |
| Canvas UI — preview iframe | ⚠️ Renders when previewUrl is resolved server-side at page render; stale if sandbox was paused. Hard-refresh works. |
| Architect triage clarifying questions | ✅ Render in ChatPanel; SSE forwarding fix means architect spinner no longer hangs forever (was reproducible all session on "checkout flow" prompts) |
| Auto-fix loop on gate failure | ✅ Works end-to-end (verified during smoke); MAX_FIX_ATTEMPTS=2 cap holds; structured errors reach the architect prompt correctly |
| Multi-stack templates (backend, mobile, CLI, GraphQL, data) | ❓ Code exists, untested end-to-end this cycle |
| Production deploy pipeline | ❌ `packages/deploy-orchestrator` exists but no end-to-end smoke; per ADR-001 the target is K8s + Argo CD + Knative |

---

## How to run a clean local smoke

1. `docker compose up -d postgres`
2. Local Claude Code CLI proxy on `:3456` (manage in a separate terminal)
3. `cd apps/atlas-web && pnpm exec next dev --turbo` (Turbopack avoids the 10-17 min webpack compile times we hit during this session)
4. Open `http://localhost:3000`, sign in (Clerk dev creds in `.env.local`), submit a prompt that doesn't trigger triage (no "checkout flow" / "payment" wording)
5. Tail the dev log for `[conductor]` events to monitor chain progression
6. When the ritual completes, the `[redeployPreview ...]` log line gives you a direct sandbox URL — opening that bypasses the canvas iframe entirely (useful when D17 manifests)
