# Plan B — Developer Role Chained Into the Ritual

> **Status:** ~70% landed. This doc is being written DURING execution because the previous "scope decisions" were a paragraph, not a plan, and trial-and-error testing is causing churn. Goal: enumerate every remaining failure mode the user will hit before they hit it.

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
