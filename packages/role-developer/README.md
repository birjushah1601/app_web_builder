# @atlas/role-developer

The **Developer role** for the Atlas conductor. Given an Architect-emitted artifact plus user intent, it generates a unified diff implementing the runnable plan via **parallel two-provider dispatch** (Anthropic Sonnet 4.6 + Google Gemini 2.5 Flash) with a lightweight **Reviewer pass** (Sonnet) that votes between the two outputs and emits the winner.

Part of Plan D.3 — implements the `Role` interface from `@atlas/conductor`.

---

## Architecture

```
RoleInvocation
      │
      ▼
DeveloperRole.run()
      │
      ├──(parallel)──▶ anthropicPass()  ─── Sonnet 4.6 + tool-use → DeveloperOutput
      │
      └──(parallel)──▶ googlePass()     ─── Gemini 2.5 Flash + tool-use → DeveloperOutput
      │
      ▼
  Promise.allSettled
      │
      ├─ both ok  → reviewerVote()  ─── Sonnet 4.6 picks winner → { winner, reasoning }
      │
      ├─ one ok   → walkover (no reviewer call)
      │
      └─ both fail → BothProvidersFailedError
      │
      ▼
RoleOutput { diff: { kind: "patch", body: <unified diff> }, events[] }
```

---

## Parallel Dispatch

Both providers receive the same prompt (assembled from three skills: `tdd-feature`, `edit-only-what-changed`, `runnable-plan`) and the Architect's artifact. They run concurrently via `Promise.all`. Each provider uses `completeWithToolUse` to constrain its response to the `emit_developer_output` tool schema:

```typescript
{
  diff: string;          // unified diff
  summary: string;       // one-line human description
  testsAdded: string[];  // file paths of new test files
  filesModified: string[]; // file paths touched
}
```

---

## Reviewer Voting

When both providers succeed, a third call (Sonnet, same `@atlas/llm-provider` `AnthropicProvider`) selects the winner using the `emit_reviewer_vote` tool:

```typescript
{ winner: "anthropic" | "google"; reasoning: string }
```

Scoring criteria (in the reviewer system prompt):
1. Test coverage
2. Diff minimality (edit-only-what-changed)
3. Adherence to the runnable plan
4. Edit discipline

---

## Walkover Semantics

| Scenario | Outcome |
|---|---|
| Both succeed | Reviewer votes; winner's diff returned |
| Anthropic fails, Google ok | Google wins by walkover; no reviewer call |
| Google fails, Anthropic ok | Anthropic wins by walkover; no reviewer call |
| Both fail | `BothProvidersFailedError` thrown; `developer.both_failed` event emitted |
| Reviewer fails (both succeeded) | Default to Anthropic per OQ4 (PRD §11.3); `developer.reviewer.failed_defaulting_anthropic` event emitted |

---

## Events

All events are on `RoleOutput.events[]` with `{ eventType, payload }`:

| Event | Emitted when |
|---|---|
| `developer.dispatch.started` | Always, at the start of `run()` |
| `developer.anthropic.completed` | Anthropic pass succeeds |
| `developer.anthropic.failed` | Anthropic pass throws |
| `developer.google.completed` | Google pass succeeds |
| `developer.google.failed` | Google pass throws |
| `developer.reviewer.voted` | Both succeed and reviewer runs successfully |
| `developer.reviewer.failed_defaulting_anthropic` | Both succeed but reviewer throws |
| `developer.walkover` | One provider fails; other wins by walkover |
| `developer.both_failed` | Both providers fail |
| `developer.completed` | Final event on successful completion |

---

## Observability

Each provider call is instrumented via `@atlas/llm-provider`'s Prometheus metrics (injected at construction). Labels: `provider`, `model`, `status`. Both Anthropic and Google calls emit `llm_call_total` and `llm_call_duration_seconds` counters into the shared registry.

---

## Construction

```typescript
import { DeveloperRole } from "@atlas/role-developer";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Registry } from "prom-client";

const metrics = createProviderMetrics(new Registry());
const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics });
const google = new GoogleProvider({ sdk: googleSdk, metrics });

const skills = createRegistryWithOverrides(loadSkillsFromDir("/path/to/skill-library"), []);

const role = new DeveloperRole({
  anthropic,
  google,
  reviewer: anthropic,   // typically same Anthropic instance
  skills,
  // optional model overrides:
  anthropicModel: "claude-sonnet-4-6",
  googleModel: "gemini-2.5-flash",
  reviewerModel: "claude-sonnet-4-6",
});

// Wired into Conductor:
const conductor = new Conductor({
  classifier,
  roles: new Map([["developer", role]]),
  checkpointSink,
  sliceBuilder,
});
```

---

## Skills Required

The three skills must be registered in the `SkillRegistry` passed at construction:

| Skill name | Purpose |
|---|---|
| `tdd-feature` | TDD discipline: write tests first, then make them pass |
| `edit-only-what-changed` | Constrain diff to the minimal set of changes |
| `runnable-plan` | Follow the Architect's step-by-step runnable plan |

In tests, fixture stubs in `test/fixtures/skills/` are used. Production wires through `@atlas/skill-library`'s real skill markdown.

---

## What Is Out of Scope (D.3)

- **No real API keys** — all provider calls are mocked in tests via injected SDK instances.
- **No `@atlas/gate-scheduler` integration** — the Developer role is a code generator, not a gate runner. Gate integration comes in D.4/D.5.
- **No `@atlas/role-shared` extraction** — `assembleDeveloperPrompt` is inlined here. If D.4/D.5 need the same helper, it will be extracted then.
- **No streaming** — `GoogleProvider.stream` is not yet implemented (use `complete`/`completeWithToolUse` for the voting flow). Streaming is deferred.
- **No `getRitualEngine` factory** — the Conductor wires DeveloperRole via the `E.2` factory in a follow-up plan.

---

## Test Suite (19 tests / 12 files)

| File | Coverage |
|---|---|
| `types.test.ts` | `DeveloperOutputSchema`, `ReviewerVoteSchema` parse + reject |
| `assemble-prompt.test.ts` | Skill assembly, `SkillMissingError` |
| `anthropic-pass.test.ts` | Sonnet tool-use path |
| `google-pass.test.ts` | Gemini tool-use path |
| `reviewer-vote.test.ts` | Reviewer tool-use + forced tool_choice |
| `role-happy-both-succeed.test.ts` | Both succeed → reviewer votes |
| `role-walkover-anthropic-fails.test.ts` | Anthropic fails → Google wins |
| `role-walkover-google-fails.test.ts` | Google fails → Anthropic wins |
| `role-both-fail.test.ts` | Both fail → `BothProvidersFailedError` |
| `role-reviewer-fails-defaults-anthropic.test.ts` | Reviewer fails → Anthropic default |
| `observability.test.ts` | Prometheus metrics emitted for both providers |
| `conductor-fit.test.ts` | End-to-end via `Conductor.dispatch` |
