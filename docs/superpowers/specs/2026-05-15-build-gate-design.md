# Build Gate (L0) — Design Spec

> Brainstormed via the `superpowers:brainstorming` skill.
> Date: 2026-05-15
> Status: Ready for `superpowers:writing-plans` after user spec review.
> Trigger: A live ritual emitted `src/app/page.tsx` with `'I'm feeling great…'` — an unescaped apostrophe inside a single-quoted JS string. The diff applied successfully, all LLM gates passed, the ritual emitted its artifact — and the live preview iframe rendered a Next.js build-error page. Today no gate in the chain compiles the code; the compiler is the only authoritative truth about compilability.

---

## 0. Executive summary

Atlas's post-developer chain audits the diff *as text* via LLM-driven gates (Security, Accessibility, Visual-Quality). None of them compile the code. When the Developer emits syntactically broken or type-incorrect code, the ritual reports success and the user discovers the failure in the live preview.

The **Build Gate (L0)** closes that hole. It runs first in `postDeveloperChain` — before any LLM gate — and exits non-zero if the per-template compiler/type-checker exits non-zero. On failure it emits a structured `BuildReport`, escalates the ritual, and folds the errors into the Plan L auto-fix loop's `priorArtifact` as a `## Build errors` section so the next Architect→Developer pass has pinpoint pointers to fix.

**Reliability is the design's only currency.** The compiler is authoritative. No log scraping, no heuristics, no silent skips: every failure mode (timeout, sandbox unreachable, unsupported template) surfaces as a typed gate failure with a distinguishable `errorKind`. A registry test fails the build if a sandbox template is added without a registered build command, so we can't ship a new stack with the gate quietly skipped.

The gate is multi-stack from day one: `tsc --noEmit` for TypeScript templates (Next.js, GraphQL Yoga, Bun CLI, Expo, Hono), `pyright --outputjson` for Python templates (FastAPI, dlt). Per-template commands live in a single registry; parsers normalize stack-specific output into one `BuildReport` shape.

Ships behind `ATLAS_FF_BUILD_GATE` — off in code (consistent with all Atlas flags), on in `apps/atlas-web/.env.local` from day one so live demos catch the failure mode immediately. Flag-OFF preserves today's chain byte-for-byte.

---

## 1. Goal & invariants

A new merge gate that **never lets uncompilable code reach the user**. Failure modes that must be caught:

- JS/TS syntax errors (apostrophe-in-single-quote, mismatched JSX, etc.)
- TypeScript type errors (any `tsc --noEmit` failure)
- Python syntax / type errors (FastAPI, dlt-python)
- Missing imports
- Per-stack equivalents for Bun CLI, Expo, GraphQL Yoga, Hono

**Invariants (the "100%" contract — apply *when the gate runs*, i.e. when `ATLAS_FF_BUILD_GATE=true`. Flag-OFF preserves today's behavior byte-for-byte; the flag is the single sanctioned escape hatch):**

1. If the compiler/checker exits non-zero → gate fails.
2. If the build process times out → gate fails (do *not* pass on timeout).
3. If the sandbox is unreachable → gate fails loudly with cause (do *not* skip).
4. If a stack has no registered build command → gate fails with `unsupported_stack` (do *not* silently skip). Enforced at build time by a registry-completeness test.
5. No log scraping, no heuristics. Compiler exit code is the only signal.

Anti-goals (explicit non-invariants — false positives are tolerable but should be minimized):

- The gate **may** report a transient sandbox failure as a build failure. The auto-fix loop's typed `errorKind` lets the prompt distinguish "fix your code" from "infra problem"; budget exhaustion eventually escalates to a human.
- The gate **does not** attempt to fix the build (no `eslint --fix`, no codemods). The Developer role does the fix via the auto-fix loop — single path through the Architect for prompt coherence.

---

## 2. Position in the chain & auto-fix integration

```
sandbox.apply.completed
  → build-gate          ← NEW: runs FIRST in postDeveloperChain
  → security-gate
  → a11y-gate           (flag-OFF today)
  → visual-quality-gate (flag-OFF today)
  → ritual.artifact_emitted
```

**Why first.** Security / A11y / VQ analyze the diff *as text* via LLM calls. They have nothing useful to say about uncompilable code — auditing it wastes Claude tokens and produces interpretive noise. Build-gate first short-circuits cleanly.

**Failure path (Plan L auto-fix integration):**

```
sandbox.apply.completed
  → build.started     {template, command}
  → build.failed      {errorKind, errors[N], durationMs, exitCode}
  → ritual.escalation_requested {gate: "L0-build"}
  → auto_fix.attempted #1
    → architect dispatched with priorArtifact.buildErrors = {errors, command, template}
    → developer dispatched (regenerates failing files)
    → sandbox.apply.completed
    → build.started ... (gate re-runs on the new diff)
  → if build.passed → security.started ...
  → if build.failed AND attempts < MAX_FIX_ATTEMPTS (=2) → another auto_fix
  → if attempts == MAX_FIX_ATTEMPTS → auto_fix.budget_exhausted → ritual ends in escalation
```

**On success:** chain continues to security-gate exactly as today; `build.passed {durationMs}` event surfaces in the rail timeline.

**Architect prompt extension** (`render-user-turn.ts` in `@atlas/role-architect`): when `priorArtifact.buildErrors` is present, inject a section *before* the existing `## Gate findings`:

```markdown
## Build errors (compiler is authoritative — fix exactly these)
Command: `pnpm exec tsc --noEmit` (template: atlas-next-ts-v2)

src/app/page.tsx:288:99
  Expected '</', got 'm'
  Offending line:
    `{ message: 'How are you feeling today?', time: '10 minutes ago', response: 'I'm feeling great, thank you!' }`

src/app/page.tsx:291:6
  …
```

The ordering is deliberate. The compiler is ground truth; LLM gate findings are interpretive. Listing build errors first signals priority to the LLM.

**Developer is unmodified.** It receives the regenerated architect plan and emits a new diff covering the named files. Existing diff-apply path handles the rest.

---

## 3. Architecture & components

**New package: `@atlas/gate-build`** (mirrors `@atlas/gate-visual-quality`'s shape — keeps gates uniform and discoverable):

```
packages/gate-build/
  package.json
  src/
    index.ts            — BuildGateRole class (implements Role interface)
    commands.ts         — Per-template command registry
    parse.ts            — Stack-specific error parsers (tsc text / pyright JSON)
    schema.ts           — BuildReport Zod schema + types
  test/
    build-gate.test.ts  — Role behavior with mocked SandboxExec
    commands.test.ts    — Registry completeness invariant
    parse-tsc.test.ts   — tsc stderr fixtures (single/multi/none)
    parse-pyright.test.ts — pyright JSON fixtures
```

**Per-template registry (`commands.ts`):**

```ts
export type ParserId = "tsc" | "pyright";

export interface BuildCommand {
  exec: string;        // shell command run inside the sandbox via SandboxExec
  parser: ParserId;    // which parser normalizes the stderr/stdout into BuildReport.errors
  timeoutMs: number;   // hard kill threshold; on hit emits errorKind: "timeout"
}

export const BUILD_COMMANDS: Record<TemplateName, BuildCommand> = {
  "atlas-next-ts":      { exec: "pnpm exec tsc --noEmit",            parser: "tsc",     timeoutMs: 60000 },
  "atlas-next-ts-v2":   { exec: "pnpm exec tsc --noEmit",            parser: "tsc",     timeoutMs: 60000 },
  "atlas-fastapi":      { exec: "python -m pyright --outputjson .",  parser: "pyright", timeoutMs: 60000 },
  "atlas-dlt-python":   { exec: "python -m pyright --outputjson .",  parser: "pyright", timeoutMs: 60000 },
  "atlas-graphql-yoga": { exec: "bun run tsc --noEmit",              parser: "tsc",     timeoutMs: 60000 },
  "atlas-bun-cli":      { exec: "bun run tsc --noEmit",              parser: "tsc",     timeoutMs: 60000 },
  "atlas-expo-rn":      { exec: "pnpm exec tsc --noEmit",            parser: "tsc",     timeoutMs: 60000 },
  "atlas-hono-bun":     { exec: "bun run tsc --noEmit",              parser: "tsc",     timeoutMs: 60000 }
};
```

A registry-completeness test enumerates the templates the sandbox factory routes to and asserts each has a `BUILD_COMMANDS` entry — covers invariant §1.4 at build time, not just at runtime.

**`BuildReport` schema (Zod):**

```ts
export const BuildReportSchema = z.object({
  passed: z.boolean(),
  errorKind: z.enum(["compile", "type", "timeout", "sandbox_unreachable", "unsupported_stack", "internal_error", "none"]),
  template: z.string(),
  command: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number().int().nonnegative(),
  errors: z.array(z.object({
    file: z.string(),
    line: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
    snippet: z.string().optional()
  })),
  rawTail: z.string().optional() // last 4KB of stderr for human debugging only
});
```

Auto-fix uses `errors[]` (structured); the rail-timeline UI surfaces `rawTail` in a collapsed `<details>` for human debugging. `errorKind: "compile"` distinguishes JS/TS syntax errors (preferred when stderr has "SyntaxError" / "Expected") from `errorKind: "type"` (type-checker findings). For pyright everything is `"type"`; the distinction only matters for the architect prompt's framing.

**`SandboxExec` adapter:** the gate package defines its own minimal `SandboxExec` interface (avoid cross-package coupling with `@atlas/gate-visual-quality`):
```ts
export interface SandboxExec {
  runCommand(input: { cmd: string; timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>;
}
```
atlas-web supplies a concrete implementation that lazy-connects per call via `E2B Sandbox.connect(sandboxId).commands.run(...)`, mirroring `gate-visual-quality`'s pattern. Future cleanup: extract a shared `@atlas/sandbox-exec` package; out of scope for v1.

**`TemplateName`:** import the literal union from `@atlas/sandbox-e2b` (where `ATLAS_DEFAULT_SANDBOX_TEMPLATE`'s typed names live). The registry's `Record<TemplateName, BuildCommand>` then fails the build the moment a new template is added without an entry — TypeScript exhaustiveness becomes part of invariant §1.4.

**Factory wiring (`apps/atlas-web/lib/llm/factory.ts`):**

New `getBuildGateRole({ sandboxId, template })` mirroring `getVisualQualityRole`. Returns `null` when `ATLAS_FF_BUILD_GATE !== "true"`. `getRitualEngine()` *prepends* it to `postDeveloperChain` (it must run before Security/A11y/VQ).

`.env.local` adds:

```
ATLAS_FF_BUILD_GATE=true   # L0: never let uncompilable code reach the user
```

`.env.example` documents the flag.

---

## 4. Edge cases & operational concerns

| Case | Behavior |
|---|---|
| Sandbox `commands.run` throws / network error | `errorKind: "sandbox_unreachable"`, gate fails (invariant §1.3). Auto-fix prompt distinguishes infra from code. |
| Command exceeds `timeoutMs` (60s) | E2B exec is killed; `errorKind: "timeout"`, gate fails (invariant §1.2). |
| Template not in `BUILD_COMMANDS` | Registry test fails the build before we ship — but at runtime, `errorKind: "unsupported_stack"`, gate fails (invariant §1.4). |
| Parser fails on unexpected stderr shape | Falls back to a synthetic single-error `{file: "?", line: 0, col: 0, message: rawTail }`. Parser never throws — always emits a `BuildReport`. |
| Gate role itself throws | Conductor catches per the existing role-failure pattern; emits `role.failed` with cause; ritual escalates with `errorKind: "internal_error"`. |
| Concurrent `next dev` HMR in the sandbox | Safe — `tsc --noEmit` is read-only, runs against on-disk state which `sandbox.apply` has already finished writing (`apply.completed` precedes `build.started`). |
| Diff didn't touch any source file (e.g., assets-only) | Build still runs; passes in seconds (cached `.tsbuildinfo` where templates enable it). Acceptable cost for the invariant. |
| `package.json` change adds a new dep that requires install before tsc | Out of scope for v1. Templates pin their deps; new deps are a rare case. Documented as a known limitation. |

**Latency budget:**

- atlas-next-ts: ~5–15s cold (small project), 2–5s warm. Acceptable on a 45–60s ritual.
- atlas-fastapi (pyright): ~8s typical.
- Adds one sequential step before the LLM gates. The Developer's parallel anthropic+google pass is already complete by then, so no parallelism is lost.

**Telemetry** (uses existing `prom-client` pattern in role packages):

- `atlas_build_gate_duration_ms` histogram (labels: template, passed)
- `atlas_build_gate_failures_total` counter (labels: template, errorKind)

**Rollout:**

- Default: `ATLAS_FF_BUILD_GATE` off in code (consistent with all Atlas flags).
- On in `apps/atlas-web/.env.local` from day one — live demos catch the failure mode immediately.
- After ~1 week of dogfood (target: 2026-05-22), revisit whether to flip default ON in code.

---

## 5. Out of scope (explicit non-goals)

- **ESLint as a gate.** ESLint is style/lint; we gate on compilability, not opinions. A separate "lint gate" could come later.
- **Test execution.** Running `pnpm test` in the sandbox is a different gate (test-gate); not in this design.
- **Coverage thresholds.** Same — separate concern.
- **Auto-fixing the build error directly** (running codemods, `eslint --fix`). The Developer role does the fix via the auto-fix loop — single path through the Architect for prompt coherence.
- **`package.json` dep installs before build.** v1 assumes deps already match the lockfile. Adding `pnpm install` to the gate command path is a follow-up.

---

## 6. Testing

- **`@atlas/gate-build` unit:**
  - Parsers: tsc fixtures (single / multi / no error / mangled stderr); pyright JSON fixtures (single / multi / no error).
  - Role: with mocked `SandboxExec` returning each `errorKind`, asserts the right `BuildReport` shape and `passed` value.
  - Registry completeness: enumerates templates from `@atlas/sandbox-e2b`, asserts equality with `Object.keys(BUILD_COMMANDS)`.
- **`@atlas/role-architect` test extension:**
  - When `priorArtifact.buildErrors` is set, the rendered user-turn contains the `## Build errors` section before any `## Gate findings`.
- **`@atlas/ritual-engine` integration:**
  - Stubbed Architect → Developer chain with a stubbed BuildGateRole returning `passed: false`; assert auto-fix attempt #1 fires with `priorArtifact.buildErrors` populated.
  - `MAX_FIX_ATTEMPTS` cap: after 2 failed build attempts, ritual emits `auto_fix.budget_exhausted` and ends in escalation.
- **`apps/atlas-web`:**
  - `test/lib/engine/factory-role-flags.test.ts`: flag-OFF (no gate registered) and flag-ON (gate registered with sandboxId/template wired correctly).
- **Manual smoke (after merge):** trigger a ritual with a prompt that historically produced the apostrophe-in-quote pattern; confirm L0 fails, auto-fix #1 succeeds, ritual completes without surfacing a build-error UI in the preview.

---

## 7. Status & next step

Spec ready for `superpowers:writing-plans`. Implementation will land behind `ATLAS_FF_BUILD_GATE`; flag-OFF preserves today's chain byte-for-byte.
