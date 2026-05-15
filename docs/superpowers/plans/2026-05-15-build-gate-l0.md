# Build Gate L0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `@atlas/gate-build` package that runs the per-template compiler/type-checker inside the sandbox before LLM gates, emits a structured `BuildReport`, and feeds errors into the Plan L auto-fix loop. Closes the hole where the Developer can ship uncompilable code and all gates still "pass".

**Architecture:** New package mirrors `@atlas/gate-visual-quality` (gate role + `SandboxExec` adapter + Zod schema). Per-template command registry (`tsc --noEmit` for TS stacks, `pyright --outputjson` for Python). Registered first in `postDeveloperChain` via `apps/atlas-web/lib/engine/factory.ts` behind `ATLAS_FF_BUILD_GATE`. The Architect's deep-plan prompt grows a `## Build errors` section above the existing `## Gate findings`. Flag-OFF preserves today's chain byte-for-byte. See spec: `docs/superpowers/specs/2026-05-15-build-gate-design.md`.

**Tech Stack:** TypeScript 5.6, Zod 3.23, Vitest 2.1, pnpm workspaces, prom-client (telemetry follow-up).

---

## File structure

**Create (new package `@atlas/gate-build`):**
- `packages/gate-build/package.json`
- `packages/gate-build/tsconfig.json`
- `packages/gate-build/vitest.config.ts`
- `packages/gate-build/src/index.ts` — re-exports
- `packages/gate-build/src/schema.ts` — `BuildReport` Zod schema + types
- `packages/gate-build/src/sandbox-exec.ts` — `SandboxExec` interface
- `packages/gate-build/src/parse.ts` — tsc + pyright parsers
- `packages/gate-build/src/commands.ts` — `BUILD_COMMANDS` registry
- `packages/gate-build/src/role.ts` — `BuildGateRole` class
- `packages/gate-build/test/schema.test.ts`
- `packages/gate-build/test/parse-tsc.test.ts`
- `packages/gate-build/test/parse-pyright.test.ts`
- `packages/gate-build/test/commands.test.ts`
- `packages/gate-build/test/role.test.ts`

**Modify (wiring):**
- `packages/ritual-engine/src/engine.ts` — add `build.{started,passed,failed}` event types to the union; chain machinery already supports arbitrary `postDeveloperChain` role IDs and treats `report.passed === false` as an escalation, so no chain-loop change needed.
- `apps/atlas-web/lib/llm/factory.ts` — add `getBuildGateRole({sandboxId, template})`.
- `apps/atlas-web/lib/engine/factory.ts` — register BuildGateRole in conductor and *prepend* it to `postDeveloperChain` when `ATLAS_FF_BUILD_GATE=true`.
- `apps/atlas-web/.env.local` — turn the flag on.
- `apps/atlas-web/.env.example` — document the flag.
- `apps/atlas-web/test/lib/engine/factory-role-flags.test.ts` — flag-OFF / flag-ON pair.
- `packages/role-architect/src/deep-plan.ts` — inject `## Build errors (compiler is authoritative — fix exactly these)` *before* `## Gate findings` when `priorArtifact.buildErrors` is present.
- `packages/role-architect/test/deep-plan-prompt.test.ts` — assert section ordering and content.
- `pnpm-workspace.yaml` — already globs `packages/*`; no change needed.

---

## Task 1: Scaffold `@atlas/gate-build` package

**Files:**
- Create: `packages/gate-build/package.json`
- Create: `packages/gate-build/tsconfig.json`
- Create: `packages/gate-build/vitest.config.ts`
- Create: `packages/gate-build/src/index.ts` (placeholder)

- [ ] **Step 1.1: Create `packages/gate-build/package.json`**

```json
{
  "name": "@atlas/gate-build",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/sandbox-e2b": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 1.2: Create `packages/gate-build/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 1.3: Create `packages/gate-build/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  }
});
```

- [ ] **Step 1.4: Create `packages/gate-build/src/index.ts` placeholder**

```ts
export {};
```

- [ ] **Step 1.5: Install workspace deps**

Run: `pnpm install`
Expected: lockfile updated, `@atlas/gate-build` registered in workspace.

- [ ] **Step 1.6: Commit**

```bash
git add packages/gate-build/package.json packages/gate-build/tsconfig.json packages/gate-build/vitest.config.ts packages/gate-build/src/index.ts pnpm-lock.yaml
git commit -m "feat(gate-build): scaffold package"
```

---

## Task 2: `BuildReport` Zod schema (TDD)

**Files:**
- Create: `packages/gate-build/src/schema.ts`
- Create: `packages/gate-build/test/schema.test.ts`

- [ ] **Step 2.1: Write the failing test `packages/gate-build/test/schema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BuildReportSchema, BuildErrorKind } from "../src/schema";

describe("BuildReportSchema", () => {
  it("accepts a passing report with empty errors", () => {
    const r = {
      passed: true,
      errorKind: "none" as const,
      template: "atlas-next-ts-v2",
      command: "pnpm exec tsc --noEmit",
      exitCode: 0,
      durationMs: 4200,
      errors: []
    };
    expect(() => BuildReportSchema.parse(r)).not.toThrow();
  });

  it("accepts a failing report with structured errors and optional rawTail", () => {
    const r = {
      passed: false,
      errorKind: "compile" as const,
      template: "atlas-next-ts-v2",
      command: "pnpm exec tsc --noEmit",
      exitCode: 1,
      durationMs: 8800,
      errors: [
        { file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm feeling…'" }
      ],
      rawTail: "...stderr…"
    };
    expect(() => BuildReportSchema.parse(r)).not.toThrow();
  });

  it("rejects negative line/col", () => {
    const bad = {
      passed: false,
      errorKind: "compile",
      template: "x",
      command: "x",
      exitCode: 1,
      durationMs: 1,
      errors: [{ file: "f", line: -1, col: 0, severity: "error", message: "x" }]
    };
    expect(() => BuildReportSchema.parse(bad)).toThrow();
  });

  it("enumerates all error kinds", () => {
    const kinds: BuildErrorKind[] = ["compile", "type", "timeout", "sandbox_unreachable", "unsupported_stack", "internal_error", "none"];
    expect(kinds.length).toBe(7);
  });
});
```

- [ ] **Step 2.2: Run test, verify fails**

Run: `pnpm -F @atlas/gate-build test`
Expected: FAIL — cannot import `../src/schema`.

- [ ] **Step 2.3: Implement `packages/gate-build/src/schema.ts`**

```ts
import { z } from "zod";

export const BuildErrorKindSchema = z.enum([
  "compile",
  "type",
  "timeout",
  "sandbox_unreachable",
  "unsupported_stack",
  "internal_error",
  "none"
]);
export type BuildErrorKind = z.infer<typeof BuildErrorKindSchema>;

export const BuildErrorSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  snippet: z.string().optional()
});
export type BuildError = z.infer<typeof BuildErrorSchema>;

export const BuildReportSchema = z.object({
  passed: z.boolean(),
  errorKind: BuildErrorKindSchema,
  template: z.string(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  errors: z.array(BuildErrorSchema),
  rawTail: z.string().optional()
});
export type BuildReport = z.infer<typeof BuildReportSchema>;
```

- [ ] **Step 2.4: Run test, verify passes**

Run: `pnpm -F @atlas/gate-build test`
Expected: PASS (4/4).

- [ ] **Step 2.5: Commit**

```bash
git add packages/gate-build/src/schema.ts packages/gate-build/test/schema.test.ts
git commit -m "feat(gate-build): BuildReport schema"
```

---

## Task 3: `SandboxExec` interface

**Files:**
- Create: `packages/gate-build/src/sandbox-exec.ts`

- [ ] **Step 3.1: Implement `packages/gate-build/src/sandbox-exec.ts`**

```ts
/**
 * Minimal sandbox execution surface needed by BuildGateRole. atlas-web supplies
 * a concrete implementation that lazy-connects to E2B per call; tests pass a
 * vi.fn-backed stub. Deliberately defined locally to avoid cross-package
 * coupling with @atlas/gate-visual-quality.
 */
export interface RunCommandInput {
  cmd: string;
  timeoutMs: number;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True iff the command was killed after exceeding timeoutMs. */
  timedOut: boolean;
}

export interface SandboxExec {
  runCommand(input: RunCommandInput): Promise<RunCommandResult>;
}

/** Thrown by SandboxExec implementations when the sandbox is unreachable. */
export class SandboxUnreachableError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(`SandboxExec: sandbox unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SandboxUnreachableError";
    this.cause = cause;
  }
}
```

- [ ] **Step 3.2: Typecheck**

Run: `pnpm -F @atlas/gate-build typecheck`
Expected: PASS.

- [ ] **Step 3.3: Commit**

```bash
git add packages/gate-build/src/sandbox-exec.ts
git commit -m "feat(gate-build): SandboxExec interface"
```

---

## Task 4: tsc parser (TDD)

**Files:**
- Create: `packages/gate-build/test/parse-tsc.test.ts`
- Create/Modify: `packages/gate-build/src/parse.ts`

- [ ] **Step 4.1: Write the failing test `packages/gate-build/test/parse-tsc.test.ts`**

`tsc --noEmit` emits errors to stdout in the form `path/file.ts(LINE,COL): error TS####: message`. We parse those lines.

```ts
import { describe, it, expect } from "vitest";
import { parseTscOutput } from "../src/parse";

describe("parseTscOutput", () => {
  it("returns empty array on clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("Found 0 errors.\n")).toEqual([]);
  });

  it("parses a single tsc error", () => {
    const out = `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.\n`;
    expect(parseTscOutput(out)).toEqual([
      {
        file: "src/app/page.tsx",
        line: 288,
        col: 99,
        severity: "error",
        message: "TS1005: Expected '</', got 'm'."
      }
    ]);
  });

  it("parses multiple errors and ignores summary lines", () => {
    const out = [
      `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.`,
      `src/lib/foo.ts(12,5): error TS2304: Cannot find name 'bar'.`,
      `Found 2 errors in 2 files.`,
      ``
    ].join("\n");
    const parsed = parseTscOutput(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].file).toBe("src/app/page.tsx");
    expect(parsed[1].file).toBe("src/lib/foo.ts");
    expect(parsed[1].line).toBe(12);
  });

  it("preserves severity for warnings", () => {
    const out = `src/x.ts(1,1): warning TS9999: future warning.\n`;
    expect(parseTscOutput(out)[0].severity).toBe("warning");
  });

  it("returns [] on completely unparseable input (caller decides what to do)", () => {
    expect(parseTscOutput("some random text\nwith no tsc errors")).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run test, verify fails**

Run: `pnpm -F @atlas/gate-build test parse-tsc`
Expected: FAIL — cannot import `parseTscOutput`.

- [ ] **Step 4.3: Implement parser in `packages/gate-build/src/parse.ts`**

```ts
import type { BuildError } from "./schema.js";

/**
 * Parse `tsc --noEmit` output. Each error line has the form:
 *   path(LINE,COL): error|warning TS####: message
 * Anything not matching the pattern is ignored — tsc summary lines, blank
 * lines, etc. Never throws.
 */
export function parseTscOutput(stdout: string): BuildError[] {
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .+?)\.?$/;
  const out: BuildError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    out.push({
      file: m[1],
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4] as "error" | "warning",
      message: m[5]
    });
  }
  return out;
}
```

- [ ] **Step 4.4: Run test, verify passes**

Run: `pnpm -F @atlas/gate-build test parse-tsc`
Expected: PASS (5/5).

- [ ] **Step 4.5: Commit**

```bash
git add packages/gate-build/src/parse.ts packages/gate-build/test/parse-tsc.test.ts
git commit -m "feat(gate-build): parse tsc --noEmit output"
```

---

## Task 5: pyright parser (TDD)

**Files:**
- Create: `packages/gate-build/test/parse-pyright.test.ts`
- Modify: `packages/gate-build/src/parse.ts`

`pyright --outputjson` emits JSON like:
```json
{ "generalDiagnostics": [
  { "file": "/code/app/main.py", "severity": "error",
    "message": "Expected expression", "range": { "start": { "line": 287, "character": 98 } } }
] }
```
Note: pyright uses 0-based `line`/`character`; we convert to 1-based.

- [ ] **Step 5.1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parsePyrightJson } from "../src/parse";

describe("parsePyrightJson", () => {
  it("returns empty array on no diagnostics", () => {
    const json = JSON.stringify({ generalDiagnostics: [] });
    expect(parsePyrightJson(json)).toEqual([]);
  });

  it("parses a single error and converts 0-based positions to 1-based", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        {
          file: "/code/app/main.py",
          severity: "error",
          message: "Expected expression",
          range: { start: { line: 287, character: 98 } }
        }
      ]
    });
    expect(parsePyrightJson(json)).toEqual([
      { file: "/code/app/main.py", line: 288, col: 99, severity: "error", message: "Expected expression" }
    ]);
  });

  it("treats unknown severities as 'error' to fail-safe", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "f.py", severity: "fatal", message: "x", range: { start: { line: 0, character: 0 } } }
      ]
    });
    expect(parsePyrightJson(json)[0].severity).toBe("error");
  });

  it("maps 'warning' through unchanged", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "f.py", severity: "warning", message: "x", range: { start: { line: 0, character: 0 } } }
      ]
    });
    expect(parsePyrightJson(json)[0].severity).toBe("warning");
  });

  it("returns [] on malformed JSON (caller decides)", () => {
    expect(parsePyrightJson("not json")).toEqual([]);
    expect(parsePyrightJson('{"unrelated":true}')).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run test, verify fails**

Run: `pnpm -F @atlas/gate-build test parse-pyright`
Expected: FAIL — `parsePyrightJson` not exported.

- [ ] **Step 5.3: Append `parsePyrightJson` to `packages/gate-build/src/parse.ts`**

```ts
interface PyrightDiagnostic {
  file?: unknown;
  severity?: unknown;
  message?: unknown;
  range?: { start?: { line?: unknown; character?: unknown } };
}

/**
 * Parse `pyright --outputjson` output. Never throws — returns `[]` on
 * malformed JSON or shapes that don't match.
 */
export function parsePyrightJson(stdout: string): BuildError[] {
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return []; }
  if (typeof raw !== "object" || raw === null) return [];
  const diags = (raw as { generalDiagnostics?: unknown }).generalDiagnostics;
  if (!Array.isArray(diags)) return [];

  const out: BuildError[] = [];
  for (const d of diags as PyrightDiagnostic[]) {
    const file = typeof d.file === "string" ? d.file : "?";
    const severity = d.severity === "warning" ? "warning" : "error";
    const message = typeof d.message === "string" ? d.message : "(no message)";
    const lineRaw = d.range?.start?.line;
    const colRaw = d.range?.start?.character;
    const line = typeof lineRaw === "number" ? lineRaw + 1 : 0;
    const col = typeof colRaw === "number" ? colRaw + 1 : 0;
    out.push({ file, line, col, severity, message });
  }
  return out;
}
```

- [ ] **Step 5.4: Run test, verify passes**

Run: `pnpm -F @atlas/gate-build test parse-pyright`
Expected: PASS (5/5).

- [ ] **Step 5.5: Commit**

```bash
git add packages/gate-build/src/parse.ts packages/gate-build/test/parse-pyright.test.ts
git commit -m "feat(gate-build): parse pyright --outputjson"
```

---

## Task 6: `BUILD_COMMANDS` registry + completeness invariant (TDD)

**Files:**
- Create: `packages/gate-build/test/commands.test.ts`
- Create: `packages/gate-build/src/commands.ts`

The registry's `Record<TemplateId, BuildCommand>` typing makes TypeScript catch new templates that don't have a build command — this is invariant §1.4 from the spec.

- [ ] **Step 6.1: Find the `TemplateId` type**

Run: `grep -n "TemplateId\|atlas-next-ts" packages/sandbox-e2b/src/types.ts`
Read it: the file defines a literal union of template names. Note the exact name (used in step 6.3).

- [ ] **Step 6.2: Write the failing test `packages/gate-build/test/commands.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BUILD_COMMANDS, type BuildCommand } from "../src/commands";

const EXPECTED_TEMPLATES: ReadonlyArray<string> = [
  "atlas-next-ts",
  "atlas-next-ts-v2",
  "atlas-fastapi",
  "atlas-dlt-python",
  "atlas-graphql-yoga",
  "atlas-bun-cli",
  "atlas-expo-rn",
  "atlas-hono-bun"
];

describe("BUILD_COMMANDS", () => {
  it("has an entry for every known template", () => {
    const keys = Object.keys(BUILD_COMMANDS).sort();
    expect(keys).toEqual([...EXPECTED_TEMPLATES].sort());
  });

  it("every entry has a non-empty exec, a known parser, and a positive timeout", () => {
    for (const [template, cmd] of Object.entries(BUILD_COMMANDS) as Array<[string, BuildCommand]>) {
      expect(cmd.exec, `${template}.exec`).not.toBe("");
      expect(["tsc", "pyright"]).toContain(cmd.parser);
      expect(cmd.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("uses pyright for Python templates and tsc for TS templates", () => {
    expect(BUILD_COMMANDS["atlas-fastapi"].parser).toBe("pyright");
    expect(BUILD_COMMANDS["atlas-dlt-python"].parser).toBe("pyright");
    expect(BUILD_COMMANDS["atlas-next-ts-v2"].parser).toBe("tsc");
    expect(BUILD_COMMANDS["atlas-bun-cli"].parser).toBe("tsc");
  });
});
```

- [ ] **Step 6.3: Run test, verify fails**

Run: `pnpm -F @atlas/gate-build test commands`
Expected: FAIL — `../src/commands` missing.

- [ ] **Step 6.4: Implement `packages/gate-build/src/commands.ts`**

```ts
import type { TemplateId } from "@atlas/sandbox-e2b";

export type ParserId = "tsc" | "pyright";

export interface BuildCommand {
  /** Shell command run inside the sandbox via SandboxExec. */
  exec: string;
  /** Which parser normalizes stdout/stderr into BuildReport.errors. */
  parser: ParserId;
  /** Hard kill threshold; on hit, BuildGateRole emits errorKind: "timeout". */
  timeoutMs: number;
}

/**
 * Per-template registry. `Record<TemplateId, BuildCommand>` makes TypeScript
 * fail the build the moment a new template is added to @atlas/sandbox-e2b
 * without a matching entry here (invariant §1.4 in the spec, enforced at
 * build time AND at runtime via `unsupported_stack`).
 */
export const BUILD_COMMANDS: Record<TemplateId, BuildCommand> = {
  "atlas-next-ts":      { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-next-ts-v2":   { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-fastapi":      { exec: "python -m pyright --outputjson .", parser: "pyright", timeoutMs: 60000 },
  "atlas-dlt-python":   { exec: "python -m pyright --outputjson .", parser: "pyright", timeoutMs: 60000 },
  "atlas-graphql-yoga": { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 },
  "atlas-bun-cli":      { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 },
  "atlas-expo-rn":      { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-hono-bun":     { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 }
};
```

> **Compile check:** if `TemplateId` doesn't already export from `@atlas/sandbox-e2b`'s index, surface it. Run `grep -n "export.*TemplateId" packages/sandbox-e2b/src/index.ts`; if absent, add `export type { TemplateId } from "./types";` to that file in a follow-up step inside this task before re-running typecheck.

- [ ] **Step 6.5: Run typecheck + test**

Run: `pnpm -F @atlas/gate-build typecheck && pnpm -F @atlas/gate-build test commands`
Expected: typecheck PASS; test PASS (3/3).

- [ ] **Step 6.6: Commit**

```bash
git add packages/gate-build/src/commands.ts packages/gate-build/test/commands.test.ts
# Include any sandbox-e2b/src/index.ts export change if you had to add one:
git add packages/sandbox-e2b/src/index.ts 2>/dev/null || true
git commit -m "feat(gate-build): per-template command registry"
```

---

## Task 7: `BuildGateRole` (TDD)

**Files:**
- Create: `packages/gate-build/test/role.test.ts`
- Create: `packages/gate-build/src/role.ts`

The role implements the `@atlas/conductor` `Role` interface. Each ritual invocation: read `template` + `sandboxId` from the role's per-call context (passed via `getBuildGateRole({sandboxId, template})` in atlas-web's factory), look up the `BuildCommand`, execute via injected `SandboxExec`, parse stdout/stderr, emit `BuildReport`.

- [ ] **Step 7.1: Write the failing test `packages/gate-build/test/role.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { BuildGateRole } from "../src/role";
import type { SandboxExec } from "../src/sandbox-exec";

function makeExec(result: Partial<Awaited<ReturnType<SandboxExec["runCommand"]>>> & { throws?: unknown }): SandboxExec {
  return {
    runCommand: vi.fn(async () => {
      if (result.throws) throw result.throws;
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        timedOut: result.timedOut ?? false
      };
    })
  };
}

describe("BuildGateRole", () => {
  it("emits passed=true when exit code is 0", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0, stdout: "Found 0 errors.\n" }) });
    const report = await role.run();
    expect(report.passed).toBe(true);
    expect(report.errorKind).toBe("none");
    expect(report.errors).toEqual([]);
    expect(report.command).toBe("pnpm exec tsc --noEmit");
    expect(report.template).toBe("atlas-next-ts-v2");
  });

  it("emits passed=false errorKind='compile' on non-zero exit with tsc errors in stdout", async () => {
    const stdout = `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.\n`;
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("compile");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].file).toBe("src/app/page.tsx");
    expect(report.errors[0].line).toBe(288);
  });

  it("emits errorKind='type' for pyright errors", async () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "/code/app.py", severity: "error", message: "Expected expression", range: { start: { line: 9, character: 4 } } }
      ]
    });
    const role = new BuildGateRole({ template: "atlas-fastapi", exec: makeExec({ exitCode: 1, stdout: json }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("type");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(10); // 0-based → 1-based
  });

  it("emits errorKind='timeout' when SandboxExec reports timedOut", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 124, stdout: "", timedOut: true }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("timeout");
  });

  it("emits errorKind='sandbox_unreachable' when SandboxExec throws", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ throws: new Error("ECONNREFUSED") }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("sandbox_unreachable");
    expect(report.exitCode).toBeNull();
    expect(report.errors[0].message).toContain("ECONNREFUSED");
  });

  it("emits errorKind='unsupported_stack' for an unknown template", async () => {
    // @ts-expect-error — deliberately unknown template at runtime
    const role = new BuildGateRole({ template: "atlas-unknown", exec: makeExec({}) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("unsupported_stack");
  });

  it("includes rawTail (last 4KB of stderr) on failure for human debugging", async () => {
    const stderr = "a".repeat(5000);
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stderr }) });
    const report = await role.run();
    expect(report.rawTail?.length).toBeLessThanOrEqual(4096);
    expect(report.rawTail?.endsWith("a")).toBe(true);
  });

  it("falls back to a synthetic single error when parser returns [] but exit code is non-zero", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout: "some unparseable junk", stderr: "boom" }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain("boom");
  });

  it("emits durationMs as a non-negative integer", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({}) });
    const report = await role.run();
    expect(Number.isInteger(report.durationMs)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 7.2: Run test, verify fails**

Run: `pnpm -F @atlas/gate-build test role`
Expected: FAIL — `BuildGateRole` missing.

- [ ] **Step 7.3: Implement `packages/gate-build/src/role.ts`**

```ts
import type { TemplateId } from "@atlas/sandbox-e2b";
import { BUILD_COMMANDS, type BuildCommand } from "./commands.js";
import { parseTscOutput, parsePyrightJson } from "./parse.js";
import { SandboxUnreachableError, type SandboxExec } from "./sandbox-exec.js";
import type { BuildError, BuildErrorKind, BuildReport } from "./schema.js";

export interface BuildGateRoleOptions {
  template: TemplateId | string;
  exec: SandboxExec;
}

export class BuildGateRole {
  static readonly roleId = "build-gate" as const;
  readonly roleId = BuildGateRole.roleId;

  private readonly template: string;
  private readonly exec: SandboxExec;

  constructor(opts: BuildGateRoleOptions) {
    this.template = opts.template;
    this.exec = opts.exec;
  }

  async run(): Promise<BuildReport> {
    const start = Date.now();
    const cmd: BuildCommand | undefined = BUILD_COMMANDS[this.template as TemplateId];
    if (!cmd) {
      return {
        passed: false,
        errorKind: "unsupported_stack",
        template: this.template,
        command: "",
        exitCode: null,
        durationMs: Date.now() - start,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `No build command registered for template "${this.template}"` }]
      };
    }

    let exitCode: number;
    let stdout: string;
    let stderr: string;
    let timedOut: boolean;
    try {
      const result = await this.exec.runCommand({ cmd: cmd.exec, timeoutMs: cmd.timeoutMs });
      exitCode = result.exitCode;
      stdout = result.stdout;
      stderr = result.stderr;
      timedOut = result.timedOut;
    } catch (err) {
      const cause = err instanceof SandboxUnreachableError ? err.cause : err;
      return {
        passed: false,
        errorKind: "sandbox_unreachable",
        template: this.template,
        command: cmd.exec,
        exitCode: null,
        durationMs: Date.now() - start,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `Sandbox unreachable: ${cause instanceof Error ? cause.message : String(cause)}` }]
      };
    }

    const durationMs = Date.now() - start;

    if (timedOut) {
      return {
        passed: false,
        errorKind: "timeout",
        template: this.template,
        command: cmd.exec,
        exitCode,
        durationMs,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `Build command timed out after ${cmd.timeoutMs}ms` }],
        rawTail: tailString(stderr)
      };
    }

    if (exitCode === 0) {
      return {
        passed: true,
        errorKind: "none",
        template: this.template,
        command: cmd.exec,
        exitCode,
        durationMs,
        errors: []
      };
    }

    // Non-zero exit. Parse with the template's parser. tsc writes errors to
    // stdout; pyright writes JSON to stdout. We pass stdout to the parser
    // for both. On parser miss, synthesize a single error from stderr.
    const parsed: BuildError[] =
      cmd.parser === "tsc" ? parseTscOutput(stdout) : parsePyrightJson(stdout);

    const errorKind: BuildErrorKind = cmd.parser === "tsc" ? "compile" : "type";

    const errors: BuildError[] = parsed.length > 0
      ? parsed
      : [{ file: "?", line: 0, col: 0, severity: "error", message: stderr.trim() || stdout.trim() || `Build failed (exit ${exitCode}) with no parseable output` }];

    return {
      passed: false,
      errorKind,
      template: this.template,
      command: cmd.exec,
      exitCode,
      durationMs,
      errors,
      rawTail: tailString(stderr)
    };
  }
}

function tailString(s: string, max = 4096): string {
  if (s.length <= max) return s;
  return s.slice(s.length - max);
}
```

- [ ] **Step 7.4: Run typecheck + test**

Run: `pnpm -F @atlas/gate-build typecheck && pnpm -F @atlas/gate-build test`
Expected: typecheck PASS; test PASS (~22/22 across all files in the package).

- [ ] **Step 7.5: Commit**

```bash
git add packages/gate-build/src/role.ts packages/gate-build/test/role.test.ts
git commit -m "feat(gate-build): BuildGateRole with structured failure modes"
```

---

## Task 8: Package export surface

**Files:**
- Modify: `packages/gate-build/src/index.ts`

- [ ] **Step 8.1: Replace `packages/gate-build/src/index.ts` contents**

```ts
export {
  BuildReportSchema,
  BuildErrorSchema,
  BuildErrorKindSchema,
  type BuildReport,
  type BuildError,
  type BuildErrorKind
} from "./schema.js";

export {
  type SandboxExec,
  type RunCommandInput,
  type RunCommandResult,
  SandboxUnreachableError
} from "./sandbox-exec.js";

export { BUILD_COMMANDS, type BuildCommand, type ParserId } from "./commands.js";

export { parseTscOutput, parsePyrightJson } from "./parse.js";

export { BuildGateRole, type BuildGateRoleOptions } from "./role.js";
```

- [ ] **Step 8.2: Build the package**

Run: `pnpm -F @atlas/gate-build build`
Expected: `dist/index.js` + `dist/index.d.ts` produced with no errors.

- [ ] **Step 8.3: Commit**

```bash
git add packages/gate-build/src/index.ts
git commit -m "feat(gate-build): public export surface"
```

---

## Task 9: Ritual-engine event types

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`

The engine already iterates `postDeveloperChain` and treats `report.passed === false` as escalation. We only need to extend the event type union so the broker/timeline can render build.* events.

- [ ] **Step 9.1: Find the event type union**

Run: `grep -n "RitualEventType\|security\.started\|security\.completed" packages/ritual-engine/src/engine.ts | head -20`
Note the lines that define the event-type alternation.

- [ ] **Step 9.2: Add build.* to the union**

Edit `packages/ritual-engine/src/engine.ts`. Wherever `"security.started" | "security.completed" | "security.passed"` appears in the `RitualEventType` union, add three new alternants alongside (alphabetical/grouped style is fine):

```ts
  | "build.started"
  | "build.passed"
  | "build.failed"
```

Also: if there is a `mapCheckpointToRitualType(...)` or equivalent function in the same file that forwards conductor checkpoints (e.g. `security.started → security.started`), add a passthrough for the three new strings. (Same shape as the security ones; copy the block and change names.)

- [ ] **Step 9.3: Run engine tests**

Run: `pnpm -F @atlas/ritual-engine test`
Expected: existing tests still PASS (no behavior change).

- [ ] **Step 9.4: Commit**

```bash
git add packages/ritual-engine/src/engine.ts
git commit -m "feat(ritual-engine): add build.{started,passed,failed} event types"
```

---

## Task 10: atlas-web LLM factory — `getBuildGateRole`

**Files:**
- Modify: `apps/atlas-web/lib/llm/factory.ts`

- [ ] **Step 10.1: Read the existing `getVisualQualityRole` (lines around 105–140) so the new function mirrors its shape**

Run: `sed -n '100,145p' apps/atlas-web/lib/llm/factory.ts`

- [ ] **Step 10.2: Append `getBuildGateRole` to `apps/atlas-web/lib/llm/factory.ts`**

Add at the end of the file:

```ts
import type { BuildGateRole as TBuildGateRole, SandboxExec as TBuildSandboxExec } from "@atlas/gate-build";

/**
 * Plan L0: construct the BuildGateRole when the feature flag is on.
 *
 * Caller supplies the live SandboxExec + template name. Returns null when
 * ATLAS_FF_BUILD_GATE !== "true" so getRitualEngine() can skip wiring it.
 */
export const getBuildGateRole = cache(
  async (params: {
    exec: TBuildSandboxExec;
    template: string;
  }): Promise<TBuildGateRole | null> => {
    if (process.env.ATLAS_FF_BUILD_GATE !== "true") return null;
    const { BuildGateRole } = await import("@atlas/gate-build");
    return new BuildGateRole({ template: params.template, exec: params.exec });
  }
);
```

- [ ] **Step 10.3: Add `@atlas/gate-build` to atlas-web's deps**

Edit `apps/atlas-web/package.json`. In `dependencies`, add (alphabetical):

```json
    "@atlas/gate-build": "workspace:*",
```

- [ ] **Step 10.4: `pnpm install` and typecheck**

Run: `pnpm install && pnpm -F atlas-web typecheck`
Expected: install OK; typecheck has no errors in `lib/llm/factory.ts` (pre-existing errors in other files are noise).

- [ ] **Step 10.5: Commit**

```bash
git add apps/atlas-web/lib/llm/factory.ts apps/atlas-web/package.json pnpm-lock.yaml
git commit -m "feat(atlas-web): getBuildGateRole factory"
```

---

## Task 11: atlas-web engine factory — register + prepend to chain

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`

- [ ] **Step 11.1: Find how Security / A11y / VQ register and chain**

Run: `grep -n "securityRole\|accessibilityRole\|visualQualityRole\|postDeveloperChain" apps/atlas-web/lib/engine/factory.ts | head -30`
Read the surrounding 20 lines to understand the pattern (role-id strings used in the chain, where the `SandboxExec` is built, where `template` is known).

- [ ] **Step 11.2: Wire BuildGateRole**

Add the build gate construction at the same site that builds VQ/Security/A11y. Use the same `SandboxExec` adapter atlas-web already builds for `getVisualQualityRole` — write a small wrapper that implements `@atlas/gate-build`'s `SandboxExec` shape (`runCommand(input) → {exitCode, stdout, stderr, timedOut}`) backed by `Sandbox.connect(sandboxId).commands.run(...)`. Pattern after the gate-vq one.

Then:

```ts
import { getBuildGateRole } from "@/lib/llm/factory";

// (within the place that assembles roles + postDeveloperChain)
const buildExec: import("@atlas/gate-build").SandboxExec = {
  async runCommand({ cmd, timeoutMs }) {
    const sandbox = await Sandbox.connect(sandboxId);
    try {
      const res = await sandbox.commands.run(cmd, { timeoutMs });
      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        timedOut: false
      };
    } catch (err) {
      // E2B SDK throws a TimeoutError when the command exceeds timeoutMs.
      // Surface it as timedOut=true rather than rethrowing so the role can
      // produce a structured "timeout" report.
      if ((err as { name?: string })?.name === "TimeoutError") {
        return { exitCode: 124, stdout: "", stderr: String(err), timedOut: true };
      }
      throw err;
    }
  }
};

const buildGate = await getBuildGateRole({ exec: buildExec, template });
const postDeveloperChain: string[] = [];
if (buildGate) {
  conductor.register("build-gate", buildGate); // exact API call mirrors how securityRole is registered nearby
  postDeveloperChain.push("build-gate"); // MUST be the first entry
}
// existing pushes for security / a11y / visual-quality follow
```

> Implementation hint: re-read the existing nearby code carefully. The conductor's `register(...)` signature, the exact name of the chain-array variable, and the location where `template` is in scope vary by codebase shape — adapt the snippet above to match. The contract is: BuildGate must be **registered** in the conductor and **prepended** to the chain when the flag is on; otherwise everything is unchanged.

- [ ] **Step 11.3: Typecheck**

Run: `pnpm -F atlas-web typecheck 2>&1 | grep -E "engine/factory|llm/factory" | head -10`
Expected: no errors in the two factory files (pre-existing TS errors in unrelated files are noise).

- [ ] **Step 11.4: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): register build-gate first in postDeveloperChain"
```

---

## Task 12: Flag + env documentation

**Files:**
- Modify: `apps/atlas-web/.env.local`
- Modify: `apps/atlas-web/.env.example`

- [ ] **Step 12.1: Add the flag to `.env.local`**

Append at the bottom (file already has many `ATLAS_FF_*` lines):

```
# L0 build gate — runs tsc / pyright before LLM gates; failures feed Plan L auto-fix
ATLAS_FF_BUILD_GATE=true
```

- [ ] **Step 12.2: Add the flag to `.env.example`**

Append:

```
# Plan L0 — Build gate. When true, runs the per-template compiler/type-checker
# in the sandbox after sandbox.apply and BEFORE Security/A11y/VQ gates.
# Failures emit a structured BuildReport and are folded into Plan L auto-fix
# as priorArtifact.buildErrors. Strongly recommended — closes the
# uncompilable-code-passes-all-gates hole.
ATLAS_FF_BUILD_GATE=false
```

- [ ] **Step 12.3: Commit**

```bash
git add apps/atlas-web/.env.local apps/atlas-web/.env.example
git commit -m "chore(atlas-web): document and enable ATLAS_FF_BUILD_GATE"
```

---

## Task 13: factory-role-flags test (flag-OFF / flag-ON)

**Files:**
- Modify: `apps/atlas-web/test/lib/engine/factory-role-flags.test.ts`

Existing file already contains flag-on/off patterns for Security/A11y/VQ. Add the mirror for the build gate.

- [ ] **Step 13.1: Read the existing patterns**

Run: `grep -n "ATLAS_FF_SECURITY_ROLE\|ATLAS_FF_VISUAL_QUALITY_GATE\|getRitualEngine\|postDeveloperChain" apps/atlas-web/test/lib/engine/factory-role-flags.test.ts`

- [ ] **Step 13.2: Add two new it() blocks**

Append within the existing `describe(...)` (filename: `apps/atlas-web/test/lib/engine/factory-role-flags.test.ts`):

```ts
it("when ATLAS_FF_BUILD_GATE is unset, build-gate is NOT registered and not in postDeveloperChain", async () => {
  delete process.env.ATLAS_FF_BUILD_GATE;
  const engine = await getRitualEngine(projectId);
  expect(engine.postDeveloperChain).not.toContain("build-gate");
});

it("when ATLAS_FF_BUILD_GATE='true', build-gate is registered and is the FIRST entry in postDeveloperChain", async () => {
  process.env.ATLAS_FF_BUILD_GATE = "true";
  const engine = await getRitualEngine(projectId);
  expect(engine.postDeveloperChain[0]).toBe("build-gate");
});
```

> The variable names (`getRitualEngine`, `engine.postDeveloperChain`, `projectId`) are taken from the existing tests in the same file — match whatever the file already uses.

- [ ] **Step 13.3: Run the test file**

Run: `pnpm -F atlas-web exec vitest run test/lib/engine/factory-role-flags.test.ts`
Expected: PASS, including the two new cases.
*Note: if the workspace has pre-existing pnpm/rollup native-binary issues from a Windows-bootstrapped node_modules, the test runner may fail to start. In that case, run a clean `pnpm install` on Linux first.*

- [ ] **Step 13.4: Commit**

```bash
git add apps/atlas-web/test/lib/engine/factory-role-flags.test.ts
git commit -m "test(atlas-web): factory flag-on/off for build-gate"
```

---

## Task 14: Architect prompt — inject `## Build errors`

**Files:**
- Modify: `packages/role-architect/src/deep-plan.ts`
- Create or Modify: `packages/role-architect/test/deep-plan-prompt.test.ts`

When `priorArtifact.buildErrors` is set, the Architect's deep-plan prompt must include a `## Build errors (compiler is authoritative — fix exactly these)` section BEFORE any `## Gate findings` section.

- [ ] **Step 14.1: Read the existing Gate findings injection**

Run: `sed -n '1,200p' packages/role-architect/src/deep-plan.ts | grep -n "Gate findings\|priorArtifact"`
Locate the function that assembles the user-turn / system-prompt. The "## Gate findings" string is in this file at line ~140 (per the earlier scan).

- [ ] **Step 14.2: Write the failing test**

Add (or extend) `packages/role-architect/test/deep-plan-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDeepPlanPrompt } from "../src/deep-plan"; // name may differ — match what the file exports

describe("deep-plan prompt — Build errors section", () => {
  const baseInput = {
    // fill in the minimum legal fields the existing tests use
  } as any;

  it("does NOT include '## Build errors' when priorArtifact has no buildErrors", () => {
    const prompt = renderDeepPlanPrompt({ ...baseInput, priorArtifact: {} });
    expect(prompt).not.toMatch(/## Build errors/);
  });

  it("includes '## Build errors' BEFORE '## Gate findings' when both are present", () => {
    const prompt = renderDeepPlanPrompt({
      ...baseInput,
      priorArtifact: {
        buildErrors: {
          command: "pnpm exec tsc --noEmit",
          template: "atlas-next-ts-v2",
          errors: [
            { file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm…'" }
          ]
        },
        gateFindings: [{ kind: "security", issue: "x" }]
      }
    });
    const buildIdx = prompt.indexOf("## Build errors");
    const gateIdx = prompt.indexOf("## Gate findings");
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeLessThan(gateIdx);
  });

  it("renders one bullet per error with file:line:col + message + snippet", () => {
    const prompt = renderDeepPlanPrompt({
      ...baseInput,
      priorArtifact: {
        buildErrors: {
          command: "pnpm exec tsc --noEmit",
          template: "atlas-next-ts-v2",
          errors: [
            { file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm feeling great!'" }
          ]
        }
      }
    });
    expect(prompt).toMatch(/src\/app\/page\.tsx:288:99/);
    expect(prompt).toMatch(/Expected '<\/', got 'm'/);
    expect(prompt).toMatch(/'I'm feeling great!'/);
  });
});
```

- [ ] **Step 14.3: Run test, verify fails**

Run: `pnpm -F @atlas/role-architect test deep-plan-prompt`
Expected: FAIL — section not rendered, or import name mismatch.

- [ ] **Step 14.4: Implement the section in `packages/role-architect/src/deep-plan.ts`**

Near the existing "## Gate findings" assembly, insert (BEFORE the Gate findings block):

```ts
// Build errors are compiler-authoritative — render them first so the model
// prioritizes them over LLM-gate findings (which are interpretive).
if (priorArtifact?.buildErrors && priorArtifact.buildErrors.errors.length > 0) {
  const { command, template, errors } = priorArtifact.buildErrors;
  sections.push(
    `## Build errors (compiler is authoritative — fix exactly these)\n` +
    `Command: \`${command}\` (template: ${template})\n\n` +
    errors.map((e: { file: string; line: number; col: number; message: string; snippet?: string }) =>
      `- ${e.file}:${e.line}:${e.col}\n  ${e.message}` +
      (e.snippet ? `\n  Offending: \`${e.snippet}\`` : "")
    ).join("\n")
  );
}
```

> The `sections` array / `priorArtifact` access pattern in this snippet is illustrative — adapt to the exact variable names used by the existing code. The contract: when `priorArtifact.buildErrors` is non-empty, append a "## Build errors" section to the prompt **before** "## Gate findings".

Also: extend the `priorArtifact` TypeScript type wherever it's declared (likely in `packages/role-architect/src/types.ts`) to allow an optional `buildErrors` field:

```ts
buildErrors?: {
  command: string;
  template: string;
  errors: Array<{
    file: string;
    line: number;
    col: number;
    severity: "error" | "warning";
    message: string;
    snippet?: string;
  }>;
};
```

- [ ] **Step 14.5: Run test, verify passes**

Run: `pnpm -F @atlas/role-architect test deep-plan-prompt`
Expected: PASS (3/3).

- [ ] **Step 14.6: Commit**

```bash
git add packages/role-architect/src/deep-plan.ts packages/role-architect/src/types.ts packages/role-architect/test/deep-plan-prompt.test.ts
git commit -m "feat(role-architect): render ## Build errors section before ## Gate findings"
```

---

## Task 15: Wire `buildErrors` into auto-fix priorArtifact

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts` (or wherever `_runRitual` / auto-fix builds the `priorArtifact` for retry)

The Plan L auto-fix loop folds the failing gate's report into `priorArtifact` already. We need it to put a `BuildReport` under `buildErrors` rather than into the generic `gateFindings` bucket.

- [ ] **Step 15.1: Find the auto-fix priorArtifact assembly**

Run: `grep -n "auto_fix\|MAX_FIX_ATTEMPTS\|priorArtifact" packages/ritual-engine/src/engine.ts | head -30`

Read the block where the gate report is folded into the next architect call. Today it likely does `priorArtifact = { ...originalArtifact, gateFindings: report.issues }` or similar.

- [ ] **Step 15.2: Add a build-gate branch**

When the failing gate's id is `"build-gate"`, set:

```ts
priorArtifact = {
  ...originalArtifact,
  buildErrors: {
    command: report.command,
    template: report.template,
    errors: report.errors
  }
};
```

…instead of (or in addition to — pick whichever is consistent with how other gates contribute to priorArtifact today) the generic `gateFindings` path. Keep both possible if multiple gates failed in the same chain run.

- [ ] **Step 15.3: Add an engine test**

Append to `packages/ritual-engine/test/engine-auto-fix-loop.test.ts`:

```ts
it("on build-gate failure, folds BuildReport into priorArtifact.buildErrors for the next attempt", async () => {
  // Use the existing stubbed architect/developer harness in this file; stub
  // a build-gate role that fails once then passes.
  const buildGate = stubRole({
    runs: [
      { passed: false, errorKind: "compile", template: "atlas-next-ts-v2", command: "pnpm exec tsc --noEmit",
        exitCode: 1, durationMs: 1, errors: [{ file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "x" }] },
      { passed: true, errorKind: "none", template: "atlas-next-ts-v2", command: "pnpm exec tsc --noEmit",
        exitCode: 0, durationMs: 1, errors: [] }
    ]
  });
  const engine = makeEngine({ postDeveloperChain: ["build-gate"], roles: { "build-gate": buildGate } });
  const result = await engine.start({ /* …existing fixture inputs… */ });
  // The second architect dispatch in this ritual should have received
  // priorArtifact.buildErrors with the failing report's errors.
  const architectCalls = architectMock.callsInThisRitual(result.ritualId);
  expect(architectCalls[1].priorArtifact.buildErrors.errors[0].file).toBe("src/app/page.tsx");
});
```

> The helper names (`stubRole`, `makeEngine`, `architectMock`) come from the existing test file — match its conventions. If the file uses inline mocks instead, follow that pattern.

- [ ] **Step 15.4: Run the engine test**

Run: `pnpm -F @atlas/ritual-engine test engine-auto-fix-loop`
Expected: existing tests still PASS; new test PASS.

- [ ] **Step 15.5: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-auto-fix-loop.test.ts
git commit -m "feat(ritual-engine): fold BuildReport into priorArtifact.buildErrors for auto-fix"
```

---

## Task 16: End-to-end smoke

**Files:** none (manual verification)

- [ ] **Step 16.1: Confirm the dev stack is up**

Postgres on :5440 healthy; atlas-web on :3000 ready. (Same setup as the session that drove this design.)

- [ ] **Step 16.2: Pick a prompt that historically produced the apostrophe-in-quote pattern**

For example: "Build a wellness app with chat suggestions like 'I'm feeling great today' shown as message bubbles."

- [ ] **Step 16.3: Run a fresh ritual and watch the rail timeline**

Expected sequence on the conductor log (visible via the persistent monitor or `tail -F` of `apps/atlas-web` dev log):

```
[conductor] dispatch.classified {"roleId":"build-gate", …}
[conductor] build.started      {"template":"atlas-next-ts-v2","command":"pnpm exec tsc --noEmit"}
[conductor] build.failed       {"errorKind":"compile","exitCode":1,"errors":[{...}]}
[conductor] ritual.escalation_requested {"gate":"L0-build"}
[conductor] auto_fix.attempted #1
[conductor] dispatch.classified {"roleId":"architect", …}
… developer → sandbox.apply → build-gate again …
[conductor] build.passed
[conductor] security.* …
[conductor] ritual.artifact_emitted
```

- [ ] **Step 16.4: Verify the preview iframe**

Once the ritual emits `artifact_emitted`, open the canvas preview. Expected: a clean app render — NO Next.js build-error UI.

- [ ] **Step 16.5: Verify the budget cap**

Manually trigger a failure mode the LLM can't fix in 2 attempts (e.g., refine with "always include `const x: number = 'bad'` somewhere"). Expected: after 2 auto-fix attempts, `auto_fix.budget_exhausted` fires and the ritual ends in escalation — the rail shows the build error report so the user can see what's still broken.

- [ ] **Step 16.6: No commit needed — manual verification only.**

---

## Self-review notes (post-write)

- **Spec coverage:** every section in `2026-05-15-build-gate-design.md` maps to a task:
  - §1 invariants → Task 7 (errorKind branches) + Task 6 (registry completeness)
  - §2 chain position + auto-fix → Task 11 (prepend) + Task 15 (priorArtifact wiring)
  - §3 architecture → Tasks 1–8 (the package)
  - §3 architect prompt → Task 14
  - §3 factory wiring + flag → Tasks 10, 11, 12, 13
  - §4 edge cases → Task 7 covers each errorKind; Task 13 covers flag-off invariance
  - §5 non-goals → no tasks needed (explicitly excluded)
  - §6 testing → Tasks 2, 4, 5, 6, 7 (unit); 13, 14, 15 (integration); 16 (smoke)
- **Telemetry (`atlas_build_gate_duration_ms` + `atlas_build_gate_failures_total`) is *not* wired in this plan.** It's a small follow-up (~20 lines: import `prom-client`, register histogram + counter, observe in `BuildGateRole.run`). Tracked as a known follow-up; not blocking.
- **`pnpm install` Linux/WSL caveat:** Task 13 may surface the pre-existing `@rollup/rollup-linux-x64-gnu` / `@esbuild/linux-x64` missing-binary issue if `node_modules` was bootstrapped on Windows. Either (a) run a clean `pnpm install` on Linux beforehand, or (b) skip the test runner in this environment and rely on typecheck + the smoke step. Not a plan defect — an environment quirk noted in the session log.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-build-gate-l0.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 16-task plan with TDD discipline.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best if you want me to keep the running atlas-web context.

Which approach?
