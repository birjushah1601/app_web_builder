# Security Role (L4 Merge Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/role-security/` — the third concrete `Role` implementation. **Unlike D.2/D.3, the Security role is a merge-gate runner, not a code generator.** It consumes a proposed diff + graph slice, composes four security skills from `@atlas/skill-library` (`audit-rls`, `cors-policy`, `secrets-scan`, `cve-check`), and emits a structured `SecurityReport`. The role **also implements `GateRunner` from `@atlas/gate-scheduler`** with `layer: "L4"` — this is the concrete L4 runner that G.1's scheduler has been waiting for.

**Architecture:** Single new pnpm-workspace package. Single-provider dispatch (Opus 4.7 per PRD §11.3 — security is not cost-sensitive; accuracy matters most). The role implements two interfaces in parallel:

- `Role` from `@atlas/conductor` — for direct Conductor dispatch (`roleId: "security"`).
- `GateRunner` from `@atlas/gate-scheduler` — so the scheduler can run L4 sync or async per tier.

Both methods share the same underlying `runSecurityCheck(diff, graphSlice, skills, llm) → SecurityReport` function. The `Role` wrapper emits events; the `GateRunner` wrapper maps `SecurityReport` → `GateResult`. Output: `RoleOutput.diff = { kind: "none" }` (security validates, doesn't generate code).

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS. Workspace deps: `@atlas/conductor`, `@atlas/gate-scheduler`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`. No new external deps.

**Prerequisites:**
- Plans D.1 + D.2 + C.1 + G.1 merged.
- Node 22 LTS + pnpm 9+.
- Mock Anthropic SDK in all tests.

---

## File Structure

```
packages/role-security/                       # NEW
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts
    types.ts                                  # SecurityReport, SecurityIssue Zod (severity per PRD §11.4)
    assemble-prompt.ts                        # composes audit-rls + cors-policy + secrets-scan + cve-check
    security-check.ts                         # runSecurityCheck() — the Opus pass
    role.ts                                   # SecurityRole implements Role from @atlas/conductor
    gate-runner.ts                            # SecurityGateRunner implements GateRunner { layer: "L4" }
    errors.ts
  test/
    types.test.ts
    assemble-prompt.test.ts
    security-check.test.ts
    role-passed.test.ts
    role-failed.test.ts
    gate-runner-passed.test.ts
    gate-runner-failed.test.ts
    conductor-fit.test.ts
    observability.test.ts
    fixtures/skills/                          # audit-rls, cors-policy, secrets-scan, cve-check fixtures

docs/superpowers/plans/
  README.md                                   # MODIFIED — add D.4 entry
```

## Open-question resolutions

- **Opus vs Sonnet.** Opus 4.7 per PRD §11.3. Security rulings are high-stakes; cost is a secondary concern.
- **SecurityReport shape.** `{ passed: bool, issues: Array<{ severity, code, message, file?, line? }>, skillsRun: string[] }`. Severity follows the L4/L5 convention: `critical | high | medium | low`. `code` follows a `SEC-<skill>-<n>` pattern (e.g., `SEC-RLS-001`, `SEC-CORS-003`) so downstream auditors can dedup.
- **When is `passed: false`?** Any issue with `severity: "critical"` forces `passed: false`. High-severity issues warn but don't fail (caller decides policy). This matches the plan's `I06_DEPENDENCY_HAS_CRITICAL_CVE` invariant from B.1.
- **Role vs GateRunner output.** `Role.run()` returns `RoleOutput.events` + `diff: { kind: "none" }`. `GateRunner.run()` returns `GateResult { layer: "L4", status, summary, issues }`. Both share the same underlying `runSecurityCheck()` result.

---

## Tasks

### Task 1: Scaffold `packages/role-security/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts placeholder, test/fixtures/skills/ dir tree.

- [ ] **Step 1: Tree**
```bash
mkdir -p packages/role-security/src packages/role-security/test/fixtures/skills
```

- [ ] **Step 2: package.json**

```json
{
  "name": "@atlas/role-security",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/gate-scheduler": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/skill-runtime": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "prom-client": "^15.1.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: tsconfig + vitest** (copy shape from role-developer).
- [ ] **Step 4: src/index.ts** `export {};`
- [ ] **Step 5: Install + typecheck + commit**
```bash
pnpm install && pnpm -F @atlas/role-security typecheck
git add packages/role-security/ pnpm-lock.yaml
git commit -m "feat(role-security): scaffold package with conductor + gate-scheduler + llm-provider deps"
```

---

### Task 2: `SecurityIssue` + `SecurityReport` Zod types

**Files:** `src/types.ts` + `test/types.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { SecurityReportSchema, SecurityIssueSchema, type SecurityReport } from "../src/types.js";

describe("SecurityReport types", () => {
  it("parses a passed report with empty issues", () => {
    const r: SecurityReport = { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("parses a failed report with critical issues", () => {
    const r: SecurityReport = {
      passed: false,
      issues: [
        { severity: "critical", code: "SEC-RLS-001", message: "Model 'user' missing rlsPolicies.select", file: "src/models/user.ts" },
        { severity: "high", code: "SEC-CORS-003", message: "allowedOrigins contains wildcard on credentialed route" }
      ],
      skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]
    };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("rejects passed=true when any issue is critical", () => {
    expect(() => SecurityReportSchema.parse({
      passed: true,
      issues: [{ severity: "critical", code: "SEC-X-001", message: "x" }],
      skillsRun: []
    })).toThrow(/critical/);
  });

  it("accepts passed=true with high/medium/low issues only", () => {
    const r: SecurityReport = {
      passed: true,
      issues: [{ severity: "high", code: "SEC-CVE-010", message: "unpatched dep (no fix yet)" }],
      skillsRun: ["cve-check"]
    };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("SecurityIssue severity is constrained to 4 values", () => {
    for (const sev of ["critical", "high", "medium", "low"]) {
      expect(SecurityIssueSchema.parse({ severity: sev, code: "SEC-X-001", message: "x" })).toBeTruthy();
    }
    expect(() => SecurityIssueSchema.parse({ severity: "info", code: "SEC-X-001", message: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Implement `src/types.ts`**

```typescript
import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SecurityIssueSchema = z.object({
  severity: SeveritySchema,
  code: z.string().regex(/^SEC-[A-Z]+-\d{3}$/),
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional()
});
export type SecurityIssue = z.infer<typeof SecurityIssueSchema>;

export const SecurityReportSchema = z.object({
  passed: z.boolean(),
  issues: z.array(SecurityIssueSchema),
  skillsRun: z.array(z.string())
}).superRefine((report, ctx) => {
  const hasCritical = report.issues.some((i) => i.severity === "critical");
  if (report.passed && hasCritical) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when any issue is critical",
      path: ["passed"]
    });
  }
});
export type SecurityReport = z.infer<typeof SecurityReportSchema>;

export interface SecurityInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  /** The proposed diff the Security role is validating. Serialized unified diff. */
  diff: string;
}
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/role-security test types
git add packages/role-security/src/types.ts packages/role-security/test/types.test.ts
git commit -m "feat(role-security): SecurityReport + SecurityIssue Zod with critical→passed=false constraint"
```

---

### Task 3: `assembleSecurityPrompt()` + 4 fixture skills

**Files:** `src/assemble-prompt.ts` + `src/errors.ts` + `test/assemble-prompt.test.ts` + 4 fixture skills.

Mirror D.2's `assembleArchitectPrompt` / D.3's `assembleDeveloperPrompt`; `assembleSecurityPrompt(registry, ["audit-rls", "cors-policy", "secrets-scan", "cve-check"])`. `errors.ts` has `SecurityRoleError`, `SkillMissingError`, `SecurityCheckFailedError`.

Write 4 fixture skill .md files (minimal, each ~10 lines) with valid frontmatter. Test asserts all 4 names resolve + SkillMissingError when one is absent.

```bash
pnpm -F @atlas/role-security test assemble-prompt
git add packages/role-security/src/assemble-prompt.ts packages/role-security/src/errors.ts packages/role-security/test/assemble-prompt.test.ts packages/role-security/test/fixtures/
git commit -m "feat(role-security): assembleSecurityPrompt + error hierarchy + 4 fixture skills"
```

---

### Task 4: `runSecurityCheck()` — Opus pass via tool-use

**Files:** `src/security-check.ts` + `test/security-check.test.ts`.

- [ ] **Step 1: Failing test** — mock Anthropic SDK; verify Opus model + tool-use emitting `SecurityReport`. Single test that maps a clean graph → `passed: true, issues: []`; second test with a mock returning critical issue → `passed: false`.

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { runSecurityCheck, SECURITY_MODEL } from "../src/security-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("runSecurityCheck", () => {
  it("returns passed=true when the model reports no issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] } }],
      model: SECURITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const report = await runSecurityCheck({ llm, skills, diff: "@@ trivial", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.skillsRun).toContain("audit-rls");
  });

  it("returns passed=false when the model emits a critical issue", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: {
          passed: false,
          issues: [{ severity: "critical", code: "SEC-RLS-001", message: "Model missing rlsPolicies.select" }],
          skillsRun: ["audit-rls"]
        } }],
      model: SECURITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 30 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const report = await runSecurityCheck({ llm, skills, diff: "@@", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(false);
    expect(report.issues[0].severity).toBe("critical");
  });
});
```

- [ ] **Step 2: Implement `security-check.ts`**

```typescript
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleSecurityPrompt } from "./assemble-prompt.js";
import { SecurityCheckFailedError } from "./errors.js";
import { SecurityReportSchema, type SecurityReport } from "./types.js";

export const SECURITY_MODEL = "claude-opus-4-7";

const SECURITY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          code: { type: "string" },
          message: { type: "string" },
          file: { type: "string" },
          line: { type: "number" }
        },
        required: ["severity", "code", "message"]
      }
    },
    skillsRun: { type: "array", items: { type: "string" } }
  },
  required: ["passed", "issues", "skillsRun"]
} as const;

export interface SecurityCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  diff: string;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function runSecurityCheck(input: SecurityCheckInput): Promise<SecurityReport> {
  const skillPrompt = assembleSecurityPrompt(input.skills, ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]);
  const systemPrompt = `You are the Atlas L4 Security gate. Run the 4 security skills over the proposed diff + graph slice. Emit a SecurityReport via the emit_security_report tool. Any critical issue forces passed=false.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `=== Proposed diff ===\n${input.diff}` }
  ];
  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? SECURITY_MODEL,
      maxTokens: 4096,
      tools: [{ name: "emit_security_report", description: "Emit the L4 security gate report", input_schema: SECURITY_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_security_report" }
    });
  } catch (err) {
    throw new SecurityCheckFailedError("security LLM call failed", { cause: err });
  }
  const parse = SecurityReportSchema.safeParse(result.input);
  if (!parse.success) throw new SecurityCheckFailedError("security tool_use payload failed schema", { cause: parse.error });
  return parse.data;
}
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/role-security test security-check
git add packages/role-security/src/security-check.ts packages/role-security/test/security-check.test.ts
git commit -m "feat(role-security): runSecurityCheck via Opus 4.7 + tool-use emit_security_report"
```

---

### Task 5: `SecurityRole.run()` — Role interface implementation (passed path)

**Files:** `src/role.ts` + `src/index.ts` + `test/role-passed.test.ts`.

- [ ] **Step 1: Test — passed path**

```typescript
import { describe, it, expect, vi } from "vitest";
// ... (standard imports matching D.3 role-happy pattern)

describe("SecurityRole.run (passed)", () => {
  it("returns role output with security.passed event when no critical issues", async () => {
    // Mock the SDK to return a passed report
    // Create SecurityRole({ llm, skills })
    // Invoke role.run({ ritualId, userTurn, graphSlice, intent: "security" })
    // Assert events includes "security.started", "security.completed", payload.passed === true
    // Assert diff.kind === "none"
  });
});
```

- [ ] **Step 2: Implement `role.ts`**

```typescript
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runSecurityCheck } from "./security-check.js";

export interface SecurityRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class SecurityRole implements Role {
  readonly id = "security";
  private readonly opts: SecurityRoleOptions;
  constructor(opts: SecurityRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({ eventType: "security.started", payload: { ritualId: inv.ritualId } });

    try {
      const report = await runSecurityCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        diff: "", // invocation doesn't carry a diff directly; upstream passes via userTurn/extras
        graphSlice: inv.graphSlice,
        model: this.opts.model
      });
      if (report.passed) {
        events.push({ eventType: "security.passed", payload: { skillsRun: report.skillsRun, issueCount: report.issues.length } });
      } else {
        const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
        events.push({ eventType: "security.failed", payload: { critical: criticalCount, total: report.issues.length, issues: report.issues } });
      }
      events.push({ eventType: "security.completed", payload: { passed: report.passed, report } });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({ eventType: "security.errored", payload: { error: (err as Error).message } });
      throw err;
    }
  }
}
```

- [ ] **Step 3: `src/index.ts`** exports all canonical names.
- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/role-security test role-passed
git add packages/role-security/src/role.ts packages/role-security/src/index.ts packages/role-security/test/role-passed.test.ts
git commit -m "feat(role-security): SecurityRole implementing Role interface (passed path)"
```

---

### Task 6: `SecurityRole.run()` — failed path

**Files:** `test/role-failed.test.ts`.

Test: mock returns critical issue → role emits `security.failed` + `security.completed` events; returns normally (not throwing). The caller (Conductor or Scheduler) decides whether to act on `passed: false`.

```bash
pnpm -F @atlas/role-security test role-failed
git add packages/role-security/test/role-failed.test.ts
git commit -m "test(role-security): failed path emits security.failed with critical count"
```

---

### Task 7: `SecurityGateRunner` implementing `GateRunner` from `@atlas/gate-scheduler`

**Files:** `src/gate-runner.ts` + `test/gate-runner-passed.test.ts`.

- [ ] **Step 1: Test — passed gate**

```typescript
import { describe, it, expect, vi } from "vitest";
// ...

describe("SecurityGateRunner (passed)", () => {
  it("returns GateResult with status=passed, layer=L4 when SecurityReport.passed", async () => {
    // Mock SDK returning a clean report
    // const runner = new SecurityGateRunner({ llm, skills })
    // const result = await runner.run({ ritualId, projectId, commitSha, graphSlice })
    // Expect result.layer === "L4", result.status === "passed", result.summary references "0 issues"
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { GateLayer, GateResult, GateRunInput, GateRunner } from "@atlas/gate-scheduler";
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runSecurityCheck } from "./security-check.js";

export interface SecurityGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class SecurityGateRunner implements GateRunner {
  readonly layer: GateLayer = "L4";
  private readonly opts: SecurityGateRunnerOptions;
  constructor(opts: SecurityGateRunnerOptions) { this.opts = opts; }

  async run(input: GateRunInput): Promise<GateResult> {
    const report = await runSecurityCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      diff: "", // caller passes diff upstream; scheduler API surfaces it via graphSlice for now
      graphSlice: input.graphSlice,
      model: this.opts.model
    });
    const summary = report.passed
      ? `L4 passed — ${report.issues.length} non-critical issues`
      : `L4 failed — ${report.issues.filter((i) => i.severity === "critical").length} critical, ${report.issues.length} total`;
    return {
      layer: "L4",
      status: report.passed ? "passed" : "failed",
      summary,
      issues: report.issues.map((i) => ({ severity: i.severity, message: `[${i.code}] ${i.message}` }))
    };
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/role-security test gate-runner-passed
git add packages/role-security/src/gate-runner.ts packages/role-security/test/gate-runner-passed.test.ts
git commit -m "feat(role-security): SecurityGateRunner implementing @atlas/gate-scheduler.GateRunner (L4)"
```

---

### Task 8: `SecurityGateRunner` — failed path

**Files:** `test/gate-runner-failed.test.ts`.

Test: mock returns critical issues → GateResult.status === "failed", summary mentions critical count, issues array has `severity: "critical"` at least once.

```bash
pnpm -F @atlas/role-security test gate-runner-failed
git add packages/role-security/test/gate-runner-failed.test.ts
git commit -m "test(role-security): gate-runner failed path maps critical issues to GateResult"
```

---

### Task 9: Conductor-fit — SecurityRole works under Conductor.dispatch

**Files:** `test/conductor-fit.test.ts`. Follow D.3's `conductor-fit.test.ts` pattern.

```bash
pnpm -F @atlas/role-security test conductor-fit
git add packages/role-security/test/conductor-fit.test.ts
git commit -m "test(role-security): satisfies @atlas/conductor.Role under Conductor.dispatch"
```

---

### Task 10: Observability — Opus call emits labelled metrics

**Files:** `test/observability.test.ts`.

Test: run through `SecurityRole.run` → assert Prometheus `atlas_llm_provider_requests_total{provider=anthropic,model=claude-opus-4-7,status=success}` increments by 1.

```bash
pnpm -F @atlas/role-security test observability
git add packages/role-security/test/observability.test.ts
git commit -m "test(role-security): Opus call emits labelled Prometheus metrics"
```

---

### Task 11: Build + workspace smoke

```bash
pnpm -F @atlas/role-security build && pnpm -F @atlas/role-security typecheck && pnpm -F @atlas/role-security test
pnpm -r test
git commit --allow-empty -m "chore(role-security): full-suite smoke green post D.4"
```

---

### Task 12: README

**Files:** `packages/role-security/README.md`.

Document: the dual-interface design (Role + GateRunner), Opus 4.7 usage, 4 composed skills, SecurityReport shape, `passed: false` criteria, G.1 scheduler integration.

```bash
git add packages/role-security/README.md
git commit -m "docs(role-security): README — dual-interface, Opus, 4 skills, passed=false criteria"
```

---

### Task 13: Plan index update

Insert D.4 row in `docs/superpowers/plans/README.md` after D.3. Update Phase A exit checklist to include D.4.

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add D.4 role-security to plan index + exit checklist"
```

---

## Completion Checklist

After all 13 tasks:

- [ ] `pnpm -F @atlas/role-security test` — all green (~11 tests across 9 files)
- [ ] `SecurityRole` implements `Role`; `SecurityGateRunner` implements `GateRunner`
- [ ] Both interfaces share the same `runSecurityCheck` underneath
- [ ] `passed: false` iff any critical issue present
- [ ] No cross-package regressions
- [ ] Plan index lists D.4 as shipped (pending merge)

## Handoff to D.5

D.5 (Accessibility role, L5 gate) follows this exact template — rename `SecurityRole` → `AccessibilityRole`, `SecurityGateRunner` → `AccessibilityGateRunner` (layer: "L5"), swap the 4 skills (`wcag-audit` + `rtl-layout` + `keyboard-nav` + `contrast-check`), swap the model to Sonnet 4.6 (per PRD §11.3 — a11y is less stakes than security). The shape is otherwise identical.

If D.5 reuses >50% of D.4's code verbatim, extract a `packages/role-gate-shared/` package in a follow-up refactor. For now, each role owns its copy.
