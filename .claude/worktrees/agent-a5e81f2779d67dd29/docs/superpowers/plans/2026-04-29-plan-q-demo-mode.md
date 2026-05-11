# Plan Q — Demo Mode (Token-Free LLM Bypass) Implementation Plan

> Lean spec — implemented inline same session, no multi-task subagent plan.

**Goal:** Add `ATLAS_FF_DEMO_MODE=true` flag that swaps the real `ArchitectRole` + `DeveloperRole` for canned-response stand-ins. The full UI/UX flow (rail, RitualTimeline, sandbox apply, preview iframe, gates, auto-fix, refinement, ChatPanel rendering) runs end-to-end with **$0 LLM spend per click**. Used for iterating on the demo UX without burning OpenRouter / Anthropic credits.

**Architecture:** Add a `DemoArchitectRole` and `DemoDeveloperRole` (both implement `Role` from `@atlas/conductor`) to `apps/atlas-web/lib/engine/demo-mode/`. The factory checks `isFeatureEnabled("demo-mode")` BEFORE the LLM-provider branch — when on, it skips all LLM provider construction and registers the demo roles instead. Demo roles emit the same event types as the real ones (`architect.pass1.completed`, `architect.pass2.completed`, `developer.completed`) so `<RitualTimeline />` progresses identically. Demo developer returns a canned unified diff that creates a working Next.js TODO app at `src/app/page.tsx`. Sandbox apply path runs unchanged — the canned diff is real, gets written to E2B, preview iframe refreshes. Plan I gates (security/a11y) still run if their flags are on (they'll pass cleanly on the canned diff or fail with deterministic findings — both are fine for demo). Plan L auto-fix triggers on canned gate failure but won't actually fix anything since the demo-developer always returns the same diff — bounded by `MAX_FIX_ATTEMPTS=2`.

**Trade-offs:**
- Flag-OFF: zero behavior change. Today's real-LLM path runs unchanged.
- Flag-ON: deterministic outputs, $0 cost, but the canned diff is fixed. Refinement re-runs the demo developer which returns the same diff — that's expected (demo mode isn't testing refinement quality, just the UX plumbing).
- Gates run on the canned diff. The TODO app diff is innocuous so security should pass; a11y might flag missing alt text on the input. That's actually GOOD — it exercises the full Plan L auto-fix loop without cost.

**Files:**
```
apps/atlas-web/lib/feature-flags.ts                          # MODIFIED: + "demo-mode" flag
apps/atlas-web/lib/engine/factory.ts                         # MODIFIED: short-circuit to demo roles when flag on
apps/atlas-web/lib/engine/demo-mode/
  demo-architect-role.ts                                     # NEW: Role that emits canned architect events
  demo-developer-role.ts                                     # NEW: Role that returns canned diff
  canned-diff.ts                                             # NEW: the unified diff content (TODO app)
apps/atlas-web/test/lib/engine/demo-mode/
  demo-roles.test.ts                                         # NEW: 4 cases (architect emits events; developer returns diff; canned diff parses; flag-off path skips them)
```

**Single feature commit** then merge to main (no separate branch — straight commit since it's flag-gated and zero risk).

---

## Shipped

Single commit on main. Implemented inline 2026-04-29 same session as Plans G/H/I/J/K/L/P. ~120 LOC across 4 new files + 2 modifications. 4 test cases. Flag-OFF preserves real-LLM path byte-for-byte.
