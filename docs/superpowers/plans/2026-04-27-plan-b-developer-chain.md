# Plan B — Developer Role Chained Into the Ritual

> **Status: SHIPPED to `main`** as of commits `9c6744e` (finalize) + `<plan-b-close-gaps merge>` (close-out). Pending one user sign-off click to verify the chain end-to-end against the live local proxy. This doc was originally written DURING execution after the user pushed back on trial-and-error; sections below are now historical except where marked **[Final]**.

**Goal:** ChatPanel → architect → developer end-to-end, with the developer's diff visible to the user. Diff is NOT applied to the live preview sandbox (that's plan C).

**Constraints:**
- User runs the local `claude-max-api-proxy` at `127.0.0.1:3456` (OpenAI-compat shim around their Claude CLI). It has known crash patterns and does NOT propagate the OpenAI `tools[]` array to the underlying CLI.
- Single-provider: anthropic + google + reviewer all point at the same proxy.
- No git/diff parsing in atlas-web yet. Just display the diff string.

---

## What's already landed (commits `74dbc66` + `715063a`)

| Component | Change | Verified |
|---|---|---|
| `@atlas/conductor` | `RoleInvocation.priorArtifact?`, `DispatchOptions.forceRoleId?` + `priorArtifact?` | 32 tests green |
| `@atlas/role-developer` | `inv.priorArtifact ?? null` instead of hard-coded `null` | 19 tests green |
| `@atlas/ritual-engine` | Chains architect → developer via `forceRoleId="developer"`. Captures `developerOutput` snapshot. Catches dispatch failures into `developer.dispatch.failed` events (no 500). | 42 tests green |
| `apps/atlas-web/lib/engine/factory.ts` | Registers `DeveloperRole` with single-provider triplet | by typecheck |
| `apps/atlas-web/lib/actions/startRitual.ts` | Returns `developerOutput` in `StartRitualResult` | 3 tests |
| `apps/atlas-web/components/ChatPanel.tsx` | Renders `DeveloperOutputCard` (summary + file count + collapsible diff) and `developer-failed` panel | 20 tests |
| `@atlas/role-architect` (deep-plan) | Inject `graphSlice` post-hoc | 30 tests |
| `OpenAICompatProvider` | Enumerate REQUIRED FIELDS in injected schema instruction | 25 tests |

---

## Remaining failure modes (predicted from code, NOT from clicks)

### F1. Developer's two parallel passes hammer the proxy simultaneously
- **Where:** `packages/role-developer/src/role.ts:29-43` — `Promise.all([anthropicTask, googleTask])`
- **Risk:** Two tool-use requests concurrent through `claude-max-api-proxy` may exacerbate its crash patterns. We've seen the proxy crash on single requests; doubling may make it worse.
- **Fix needed:** Add an env flag `ATLAS_DEVELOPER_SEQUENTIAL=true` (or auto-detect single-provider) that runs the passes sequentially instead of in parallel. Halves throughput but reduces crash blast radius.
- **Decision needed:** Do this preemptively, or wait to see if the proxy actually crashes?

### F2. Developer schema requires 4 fields the model must produce
- **Schema:** `{ diff: string, summary: string, testsAdded: string[], filesModified: string[] }` — all required.
- **Risk:** Same problem the architect had — model omits a required field. `testsAdded` and `filesModified` arrays are easy to forget when the model is focused on the diff.
- **Mitigation already in place:** `OpenAICompatProvider` now enumerates required fields by name in the system message (715063a). Should help.
- **Residual risk:** Model produces a diff string with surrounding prose ("Here's the diff:" + JSON), which my `extractJsonFromContent` should still parse via fenced/balanced-brace fallback.

### F3. Diff content with embedded backticks could break fenced-block parser
- **Where:** `extractJsonFromContent` in `openai-compat-provider.ts`
- **Risk:** If model emits `\`\`\`json\n{"diff": "...```javascript\n...```..."}\n\`\`\`` — the inner backticks confuse the regex `/\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`/`.
- **Mitigation in place:** Falls through to balanced-brace scan, which handles nested braces correctly via depth counting + string-awareness.
- **Residual risk:** Diff content containing literal `}` inside a string field with no escape might confuse the brace counter. Low — the model emits valid JSON or it doesn't parse at all (caught with clear error).

### F4. Reviewer enum constraint
- **Schema:** `{ winner: "anthropic" | "google", reasoning: string }`
- **Risk:** Model emits "Anthropic" or "anthropic-pass" instead of exactly "anthropic". Zod rejects → `BothProvidersFailedError` (developer treats reviewer-fail as defaulting to anthropic, per OQ4 — see role.ts:65-72).
- **Fix needed:** None — graceful fallback already exists.

### F5. Developer's `cache_control` on system messages is silently dropped
- **Where:** `anthropic-pass.ts:13` — `cache_control: { type: "ephemeral" }` on the system role message.
- **Risk:** `OpenAICompatProvider.toOpenAiMessages` only forwards `role` + `content` strings. `cache_control` is dropped.
- **Impact:** Anthropic prompt caching savings don't happen. Functional impact: NONE — request still works, just costs more tokens.
- **Fix needed:** None for plan B. Note for future.

### F6. The proxy crashed earlier on a single request and recovered. Developer adds 3 more LLM hops.
- **Risk:** Proxy crashes on any of the 3 new hops → developer dispatch fails → captured into `developer.dispatch.failed` event.
- **Mitigation:** ritual-engine already catches and surfaces this gracefully (no 500). User sees architect plan + a red "Developer step failed" card with the underlying message.
- **Fix needed:** None. The plumbing is correct; the failure is on the proxy side.

### F7. Total wall-time
- 5 LLM hops (architect-triage + architect-deepplan + dev-anthropic + dev-google + reviewer)
- ~10s each through the local proxy = ~50s
- ChatPanel `pending` is true the whole time. Send button disabled.
- **Fix needed:** None for plan B. Streaming progress would be plan-D-tier work.

---

## Decisions I need from you BEFORE the next click

1. **F1: parallel vs sequential developer passes?** I recommend sequential for the single-proxy setup — half the speed, half the proxy load, much less likely to cascade-fail. Add `ATLAS_DEVELOPER_SEQUENTIAL=true` as an env opt-in, default off (preserves current behavior for multi-provider deployments). One-line config change in factory.ts to read the env, ~10-line change in `role.ts` to switch dispatch. ~30 min including a test.

2. **Test strategy:** I'd like to write a unit test in `@atlas/ritual-engine` that simulates the full architect→developer chain with stubbed roles, verifying:
   - Architect output flows into developer's `priorArtifact`
   - Developer output is captured into `RitualSnapshot.developerOutput`
   - `developer.dispatch.failed` event is recorded when developer throws
   - Ritual still returns 200 even when developer fails
   This catches everything the user would discover by clicking, in vitest in <5s. Worth doing? ~45 min.

3. **What to do if F2 hits.** When the model omits `testsAdded` or `filesModified`, options are:
   - (a) Make those optional in the Zod schema (relax)
   - (b) Inject defaults post-hoc in `anthropic-pass.ts` (`testsAdded: [], filesModified: []`)
   - (c) Re-prompt the model with stricter wording
   I'd default to **(b)** — same pattern as the graphSlice fix; data the user doesn't actually consume. Acceptable?

---

## Plan if you sign off

**Stop. No more user clicks until these are done.**

1. **Audit-driven test** (F2 + F6 + F7 covered) — write the simulation test in ritual-engine. `30-45 min`
2. **F1 fix** — sequential opt-in. `30 min`
3. **F2 mitigation** — post-hoc default `testsAdded: [], filesModified: []` in both passes. `15 min`
4. **One sign-off click from you** to verify end-to-end with the live proxy.
5. **If green** → plan B is done. Move to plan C (apply diff to sandbox).
6. **If red** → the simulation test should catch it; work from the failure mode, not from another browser click.

**Total estimated time: ~90 min before your next click.**

---

## What's NOT in plan B (deferred)

- **Plan C: apply the diff to the live E2B sandbox.** Needs a unified-diff parser or `git apply` inside the sandbox via `E2BExec`. Sandbox needs git installed (Dockerfile change → template rebuild → ~3 min build).
- **Streaming progress** — show "architect running..." → "developer running..." → "reviewer voting..." as they happen. Right now the user just stares at a spinner for 50s.
- **Multi-turn refinement** — user reads developer output, asks for changes, ritual re-runs with feedback. Not wired.
- **Reviewer role registration as a separate Conductor role.** It's currently called inline by DeveloperRole; making it a top-level role would require its own dispatch path.
- **AG-UI / structured input forms** for the architect's blocking questions (per the research note from earlier).

---

## Sign-off prompt

Reply with one of:
- **"go"** — execute as written, three steps then one click.
- **"go but skip 1"** / **"skip 2"** / **"skip 3"** — subset.
- **"defer F1"** / **"defer F2"** — keep current behavior, click first, see what fails.
- **Specific objection** — change scope before I touch anything.

---

## [Final] What actually shipped — close-out audit

User said "go." Three commits landed (commit hashes accurate at time of writing):

| # | Commit | What |
|---|---|---|
| 1 | `9c6744e` | Chain test (7) + sequential mode (3 tests) + post-hoc defaults (8 tests) |
| 2 | `<close-gaps merge>` | 6 new factory.test.ts cases + this doc update + audit doc refresh |

### F1 — Sequential developer passes

**Status:** ✅ DONE.

- `DeveloperRoleOptions.parallelMode?: "parallel" | "sequential"` (default `"parallel"`)
- `factory.ts` reads `process.env.ATLAS_DEVELOPER_SEQUENTIAL === "true"` (strict opt-in) and passes through
- `apps/atlas-web/.env.local` set `ATLAS_DEVELOPER_SEQUENTIAL=true` for the user's single-proxy setup
- Tests:
  - `packages/role-developer/test/role-sequential-mode.test.ts` (3 cases) — proves concurrency vs strict-order, functional equivalence
  - `apps/atlas-web/test/lib/engine/factory.test.ts` (3 new cases) — env wiring through to constructor option

### F2 — Post-hoc defaults for `testsAdded` + `filesModified`

**Status:** ✅ DONE.

- `withDefaults()` exported from `anthropic-pass.ts`, re-used by `google-pass.ts`
- Defaults `testsAdded: []` when missing
- For `filesModified` (schema requires `.min(1)`), parses file paths from `diff --git a/X b/X` and `+++ b/X` headers; falls back to `["unspecified"]` only when the diff has no recognizable paths; deduplicates
- Doesn't overwrite when the model supplied the field
- Tests: `packages/role-developer/test/with-defaults.test.ts` (8 cases) covering pass-through, defaults, parsing, dedupe, fallback, type-safety

### Decision 2 (simulation test)

**Status:** ✅ DONE.

- `packages/ritual-engine/test/engine-developer-chain.test.ts` (7 cases) covers:
  - architect→developer handoff routes `priorArtifact` correctly
  - `developerOutput` captured in snapshot
  - `roleEvents` concatenates from both dispatches
  - developer dispatch failure → `developer.dispatch.failed` event, ritual still returns 200
  - cosmetic editClass skips developer dispatch entirely
  - architect with no artifact (triage blocked) skips developer
  - `diff.kind="none"` leaves `developerOutput` unset

### Final test counts (across affected packages)

| Package | Before plan B | After plan B |
|---|---|---|
| `@atlas/conductor` | 30 | 32 |
| `@atlas/ritual-engine` | 42 | 49 |
| `@atlas/role-developer` | 19 | 30 |
| `@atlas/role-architect` | 29 | 30 |
| `apps/atlas-web` (vitest) | 175 | 198 |
| `apps/atlas-web` (Playwright smoke) | 3 | 3 |

`pnpm typecheck` clean across the workspace.

### Residual unknowns (require the live click)

The sim test proves wiring. It does NOT prove:

1. The proxy survives 5 LLM hops (architect-triage + architect-deepplan + dev-anthropic + dev-google + reviewer) without crashing.
2. The model actually emits parseable JSON matching `DeveloperOutputSchema` once it sees the prompt-injected schema.
3. End-to-end wall time stays bounded (estimate 45–60 s; haven't measured).
4. The reviewer model picks `winner ∈ ["anthropic","google"]` in lowercase as the schema requires (could fall through to `developer.reviewer.failed_defaulting_anthropic` and still work; tested at unit level).

If any of those fail, the user will see one of the predicted error panels (red `developer-failed` card, indigo developer card with diff, or amber needs-input). All three rendering paths are covered in `ChatPanel.test.tsx`.
