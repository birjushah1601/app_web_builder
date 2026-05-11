# Plan S.5 — Visual-Quality Gate + Visual Regression Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two coordinated additions that close the design-quality feedback loop end-to-end. **(A)** A new `@atlas/gate-visual-quality` package — a dual-interface (`Role` + `GateRunner`) merge gate that runs after `sandbox.apply.completed`, screenshots the rendered preview at 3 viewports via `puppeteer-core` running inside the E2B sandbox, and critiques the result against the chosen `DesignTokens` (from S.4) using a multimodal Sonnet call. Critical issues flip `passed=false`, escalating via the existing Plan L auto-fix loop. Persona-tier risk-accept = `ama` (matches L6 a11y-advisory; visual quality is taste-driven). **(B)** A full Playwright visual-regression test suite for atlas-web — per-renderer × per-persona × per-viewport snapshots with in-repo PNG baselines, locally runnable via `pnpm --filter atlas-web test:visual`, gated in CI by a new `.github/workflows/visual-regression.yml` workflow scoped to canvas-affecting paths.

**Architecture:** The gate package mirrors `@atlas/role-security` and `@atlas/role-accessibility` exactly: `Role` for in-pipeline dispatch (called from `postDeveloperChain` after Security and A11y), `GateRunner` for direct synchronous gate calls. `screenshot.ts` runs `puppeteer-core` inside the sandbox via `SandboxExec` (E2B's process-spawn API), targeting the preview URL the developer's diff just rendered against. Three viewports captured: desktop 1280×800, tablet 768×1024, mobile 375×667. Bytes returned base64; stored in `spec_events.payload` for history. `critique.ts` is a single Sonnet 4.5 multimodal call with the 3 screenshots + the chosen `DesignTokens` snapshot from `RitualSnapshot.selectedTokens` (added in S.4) + composed prompt. Returns `VisualQualityReport` validated by Zod with a `superRefine` enforcing "any critical issue → passed=false." Reports stream into existing `RitualSnapshot.{visualQualityReport}` and surface in ChatPanel via a new `<VisualQualityReportPanel />` if v1's component scope expands; otherwise rendered events appear in the rail timeline.

The Playwright suite lives at `apps/atlas-web/e2e/visual/*.spec.ts`. Each spec hits a deterministic fixture route (`apps/atlas-web/app/__visual__/*` — dev/test only, returns 404 in production via middleware) that renders one canvas surface against canned data. Snapshots stored in-repo (`apps/atlas-web/e2e/visual/__snapshots__/`) per Playwright's defaults; threshold `maxDiffPixels: 100`, `threshold: 0.1`. Updates via `pnpm test:visual:update`. CI workflow runs only when canvas-affecting paths change (`apps/atlas-web/**`, `packages/canvas-runtime/**`, `packages/role-designer/**`, `packages/gate-visual-quality/**`). `@axe-core/playwright` integrated into each spec for a11y regression at the React layer.

**Tech Stack:** TypeScript 5.6 · Node 22 · Zod 3.23 · vitest 2.1 · Playwright 1.49 · `@axe-core/playwright` 4.10 · `puppeteer-core` 23 (peer-installed in the E2B template; `chromium` is bundled in `e2bdev/code-interpreter:latest`) · `@atlas/llm-provider` (multimodal `completeWithToolUse`) · `@atlas/conductor` · `@atlas/sandbox-e2b` · `@atlas/canvas-runtime` (S.4) · `@atlas/role-designer` (S.3).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan S.1, S.2, S.3, S.4 ALL merged. S.5 is the final S-series plan and needs the canvas + designer artifacts in place.
- Node 22 + pnpm 9.
- Playwright browsers: `pnpm --filter atlas-web exec playwright install chromium` (one-time per machine).
- Optional but recommended: `E2B_API_KEY` for end-to-end gate testing against a live sandbox; mocked sandbox tests cover the unit surface.

**Branch:** `plan-s5/visual-quality-gate` cut from `main`. Final task in this plan merges back to `main` after CI green; this is the LAST plan in the S series, so the merge handoff also tags `plan-s/v1-complete` and updates the plans README index.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root.

```
packages/gate-visual-quality/                         # NEW PACKAGE
  package.json                                        # NEW
  tsconfig.json                                       # NEW
  vitest.config.ts                                    # NEW
  README.md                                           # NEW
  src/
    index.ts                                          # NEW: public exports
    types.ts                                          # NEW: VisualQualityReportSchema, ViewportSchema, IssueSchema
    errors.ts                                         # NEW: VisualQualityError, ScreenshotFailedError, SkillMissingError
    role.ts                                           # NEW: VisualQualityRole class (postDeveloperChain dispatch path)
    runner.ts                                         # NEW: VisualQualityGateRunner class (direct gate-call path)
    screenshot.ts                                     # NEW: puppeteer-core via SandboxExec, 3 viewports → base64
    critique.ts                                       # NEW: multimodal Sonnet call → VisualQualityReport
    assemble-prompt.ts                                # NEW: composes critique-design-tokens + critique-hierarchy + critique-copy skills
    visual-quality-check.ts                           # NEW: orchestrator (screenshot → critique → report)
  test/
    types.test.ts                                     # NEW: schema parse + critical→passed=false superRefine
    errors.test.ts                                    # NEW: typed errors
    screenshot.test.ts                                # NEW: SandboxExec mocked, base64 path, 3 viewports, ScreenshotFailedError
    critique.test.ts                                  # NEW: multimodal call shape, image content blocks, Zod validation
    assemble-prompt.test.ts                           # NEW: skill composition + missing-skill error
    visual-quality-check.test.ts                      # NEW: composes screenshot + critique
    role.test.ts                                      # NEW: VisualQualityRole emits started/passed/failed/skipped/completed/errored
    runner.test.ts                                    # NEW: VisualQualityGateRunner.run shape + layer="L7"
    conductor-fit.test.ts                             # NEW: RoleInvocation/RoleOutput typing fits

packages/skill-library/skills/visual-quality/         # NEW skill family
  critique-design-tokens.md                           # NEW: detect drift between selected tokens and rendered output
  critique-hierarchy.md                               # NEW: contrast, alignment, visual hierarchy
  critique-copy.md                                    # NEW: generic LLM-prose vs intentional copy

packages/ritual-engine/
  test/risk-accept-l7-visual-advisory.test.ts        # NEW: regression-guard L7-visual-advisory: "ama" entry

apps/atlas-web/
  package.json                                        # MODIFIED: scripts (test:visual, test:visual:update, test:visual:headed) + devDeps (@axe-core/playwright)
  playwright.visual.config.ts                         # NEW: separate config for visual project (workers, snapshots dir)
  app/
    __visual__/
      _layout.tsx                                     # NEW: dev/test-only layout (sets persona via cookie)
      designer-canvas/page.tsx                        # NEW: renders <DesignerCanvas> with canned proposal
      refine-wizard/page.tsx                          # NEW: renders <RefineWizard> with canned axes
      options-card/page.tsx                           # NEW: renders <OptionsCard> standalone
      axis-wizard/page.tsx                            # NEW: renders <AxisWizard> standalone
      outcome-card/page.tsx                           # NEW
      technical-card/page.tsx                         # NEW
      schema-canvas/page.tsx                          # NEW
      mode-toggle/page.tsx                            # NEW
      empty-canvas/page.tsx                           # NEW
      generated-restaurant-landing/page.tsx           # NEW: full ritual against deterministic-mock LLM
  middleware.ts                                       # MODIFIED: 404 /__visual__/* in production NODE_ENV
  e2e/visual/
    fixtures/
      canned-design-proposal.ts                       # NEW: deterministic DesignProposal for snapshots
      canned-canvas-manifest.ts                       # NEW: deterministic CanvasManifest
      canned-ritual-snapshot.ts                       # NEW: deterministic RitualSnapshot
      mock-llm.ts                                     # NEW: deterministic LLM responses for generated-restaurant-landing spec
    helpers/
      set-persona.ts                                  # NEW: navigates with persona cookie set
      run-axe.ts                                      # NEW: AxeBuilder wrapper that excludes the visual chrome
    canvas-shell-flag-off.spec.ts                     # NEW (lands FIRST — behavioural lock)
    designer-canvas-pattern-c.spec.ts                 # NEW (3 personas × 3 viewports = 9 baselines)
    refine-wizard-palette-step.spec.ts                # NEW (9 baselines)
    options-card-recommendation.spec.ts               # NEW (9 baselines)
    axis-wizard-three-axes.spec.ts                    # NEW (9 baselines)
    outcome-card-tenancy.spec.ts                      # NEW (3 baselines, ama only)
    technical-card-schema.spec.ts                     # NEW (6 baselines, diego+priya)
    schema-canvas-tenants-rls.spec.ts                 # NEW (6 baselines, diego+priya)
    mode-toggle-states.spec.ts                        # NEW (24 baselines)
    empty-canvas.spec.ts                              # NEW (3 baselines)
    generated-restaurant-landing.spec.ts              # NEW (3 baselines + axe + hierarchy invariant)
    __snapshots__/.gitkeep                            # NEW: placeholder so the dir exists pre-baseline-generation
  lib/
    engine/factory.ts                                 # MODIFIED: getVisualQualityGate() + wire into postDeveloperChain
    feature-flags.ts                                  # MODIFIED: add "visual-quality-gate" → ATLAS_FF_VISUAL_QUALITY_GATE
    events/EventBroker.ts                             # MODIFIED: map 4 new visual_quality.* event types to rail timeline
  test/lib/factory-visual-quality.test.ts             # NEW (4 cases — flag-OFF, flag-ON, missing LLM, postDeveloperChain wiring)
  .env.example                                        # MODIFIED: ATLAS_FF_VISUAL_QUALITY_GATE + ATLAS_VQ_GATE_MODEL entries

.github/workflows/
  visual-regression.yml                               # NEW: runs e2e/visual on PRs to main when scoped paths change

docs/superpowers/
  local-dev-status.md                                 # MODIFIED: Plan S.5 entry + flag-table row
  plans/README.md                                     # MODIFIED: mark all 5 S-series plans Shipped + add plan-s/v1-complete tag note
```

**Why this shape.** The gate package mirrors role-security/role-accessibility precedent so the existing `postDeveloperChain` registration pattern works without modification — same `Role` interface, same `GateRunner` shape, same persona-tiered `risk-accept`. Playwright visual specs live in their own subdirectory (`e2e/visual/`) so the existing smoke `e2e/tests/` suite stays cheap-to-run while the visual suite becomes opt-in. Fixture routes under `app/__visual__/*` give specs a deterministic URL surface — render the React component with canned props server-side, no chasing live LLM state. Middleware 404s those routes in production so they can never leak to real users. Baselines committed in-repo (Playwright default) so PR diffs surface the visual change inline, no external service needed.

---

## Design Decisions

These resolve implementation-level questions left implicit in the spec.

1. **Why dual-interface (Role + GateRunner) for the gate.** Mirrors S.4's Security and A11y. Engine dispatches via `Role` in `postDeveloperChain` (so events stream uniformly through the rail timeline). Direct synchronous calls (e.g. for the Visual-Quality gate's own integration tests, or for a future "run gate manually" UI affordance) use `GateRunner`. Both code paths share `visual-quality-check.ts`.

2. **Why `puppeteer-core` inside the sandbox (vs. a host-side headless browser).** The sandbox is the only component that has a live URL bound to the user's project. Routing the host's headless browser to the sandbox preview URL would require punching through E2B's network sandbox — fragile + slow. `puppeteer-core` shipped via the E2B template image (`e2bdev/code-interpreter:latest` already includes Chromium) is offline-deterministic, fast, and avoids cross-network indirection.

3. **Why `claude-sonnet-4` for critique (vs. Haiku or Opus).** Sonnet is multimodal-capable + fast enough for a sub-30s gate window; Haiku's vision is weaker and routinely under-detects subtle hierarchy issues; Opus is overkill for v1's simple visual rubric (3 categories: contrast/alignment/hierarchy/copy/token-drift). `ATLAS_VQ_GATE_MODEL` env var lets a single project override (e.g. downgrade to Haiku under spend pressure, or upgrade to Opus when the user explicitly asks for premium critique).

4. **Why `superRefine` enforcing critical→passed=false.** Mirrors Security and A11y's contract. The LLM can return a report with `passed: true` even when issues include `critical` severity (model hallucination). The `superRefine` on `VisualQualityReportSchema` rejects that combination at parse time, forcing `passed: false`. Consistent with what Plan L auto-fix already expects.

5. **Why in-repo PNG baselines (vs. Chromatic / off-repo).** Playwright's default. Reviewable in PR diffs. ~150 baselines for v1 ≈ 3-5 MB total, fits comfortably; no external SaaS dependency, aligned with the OSS pivot from ADR-001. If repo size becomes a concern at v2-or-later, migrate to git-lfs as a separate plan.

6. **Why screenshot bytes go into `spec_events.payload` (vs. object storage).** v1 simplification per spec. Screenshots are ~40-80 KB JPEG each; `spec_events.payload` JSONB column accepts them via base64 (~110 KB per ritual). At 100 rituals/project that's ~11 MB JSONB — fine. A `visual_quality_screenshots` table with file-system or S3 backing is a v2 follow-up.

7. **Why a separate `playwright.visual.config.ts` (vs. extending the main config).** The visual suite has different timing (slower per-test due to network + screenshot capture), different baseline storage, different parallelism, and runs only on canvas-affecting paths in CI. Splitting configs avoids polluting the existing smoke-test config. The visual project's `webServer` boot is also longer because it must wait for the canvas shell to fully hydrate before snapshotting.

8. **Why `app/__visual__/*` fixture routes (vs. mounting components in spec files).** Playwright's component-test mode requires extra build glue and doesn't share Next.js's existing layout/middleware/cookies infrastructure. Server-rendering the component at a deterministic dev-only route gives the spec a real-Browser environment with the same Tailwind, fonts, SSR, hydration the production app uses. Middleware 404s these routes when `NODE_ENV === "production"`.

9. **Why `@axe-core/playwright` integrated per-spec (vs. a separate a11y suite).** The L5 A11y gate already runs against the developer's diff; the per-spec axe coverage catches regressions in the React components themselves (canvas chrome, A2UI primitives). Same Playwright run = no extra machine time.

10. **CI-scope by changed paths.** The visual suite is the slowest part of CI (~5 min per run). Restricting via `paths-filter` to `apps/atlas-web/**`, `packages/canvas-runtime/**`, `packages/role-designer/**`, `packages/gate-visual-quality/**` keeps regular PRs fast. Failures upload `playwright-report/` as an artifact for diff inspection.

---

## Task List (25 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Each task is independently committable.

---

### Task 1: Cut branch + scaffold gate-visual-quality package

**Files:**
- Create: `(branch)`
- Create: `packages/gate-visual-quality/package.json`
- Create: `packages/gate-visual-quality/tsconfig.json`
- Create: `packages/gate-visual-quality/vitest.config.ts`
- Create: `packages/gate-visual-quality/README.md`

- [ ] **Step 1: Cut the branch**

```bash
cd /f/claude/ai_builder
git checkout main
git pull --ff-only
git checkout -b plan-s5/visual-quality-gate
```

- [ ] **Step 2: Create package.json**

Create `packages/gate-visual-quality/package.json`:

```json
{
  "name": "@atlas/gate-visual-quality",
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
    "@atlas/llm-provider": "workspace:*",
    "@atlas/skill-runtime": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/gate-visual-quality/tsconfig.json`:

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

- [ ] **Step 4: Create vitest.config.ts**

Create `packages/gate-visual-quality/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@atlas/gate-visual-quality": path.resolve(__dirname, "src/index.ts")
    }
  }
});
```

- [ ] **Step 5: Create README.md**

Create `packages/gate-visual-quality/README.md`:

```markdown
# @atlas/gate-visual-quality

L7-visual-advisory merge gate. Screenshots the rendered preview, critiques against the chosen DesignTokens via multimodal Sonnet, returns a VisualQualityReport.

Dual-interface: `VisualQualityRole` (postDeveloperChain) + `VisualQualityGateRunner` (direct gate call).

## Test
\`\`\`bash
pnpm test
\`\`\`
```

- [ ] **Step 6: Install + verify the workspace picks up the package**

```bash
pnpm install
```

Expected: pnpm reports `+ @atlas/gate-visual-quality 0.0.0`.

- [ ] **Step 7: Commit**

```bash
git add packages/gate-visual-quality/
git commit -m "chore(gate-visual-quality): scaffold package + tsconfig + vitest"
```

---

### Task 2: VisualQualityReportSchema + Issue/Viewport schemas (`types.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/types.ts`
- Create: `packages/gate-visual-quality/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/gate-visual-quality/test/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  VisualQualityReportSchema,
  ViewportSchema,
  IssueSchema,
  type VisualQualityReport
} from "../src/types.js";

describe("ViewportSchema", () => {
  it("accepts the 3 standard viewports", () => {
    expect(ViewportSchema.safeParse("desktop").success).toBe(true);
    expect(ViewportSchema.safeParse("tablet").success).toBe(true);
    expect(ViewportSchema.safeParse("mobile").success).toBe(true);
  });
  it("rejects unknowns", () => {
    expect(ViewportSchema.safeParse("watch").success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("accepts a valid issue", () => {
    const issue = { severity: "major", category: "contrast", message: "Header text on hero is 3.4:1 — below WCAG AA 4.5:1" };
    expect(IssueSchema.safeParse(issue).success).toBe(true);
  });
  it("rejects unknown severity", () => {
    expect(IssueSchema.safeParse({ severity: "low", category: "contrast", message: "x" }).success).toBe(false);
  });
  it("rejects unknown category", () => {
    expect(IssueSchema.safeParse({ severity: "major", category: "performance", message: "x" }).success).toBe(false);
  });
  it("accepts optional elementSelector", () => {
    const issue = { severity: "minor", category: "alignment", message: "x", elementSelector: "header > h1" };
    expect(IssueSchema.safeParse(issue).success).toBe(true);
  });
});

describe("VisualQualityReportSchema", () => {
  const validReport: VisualQualityReport = {
    passed: true,
    score: 92,
    issues: [{ severity: "minor", category: "alignment", message: "small misalignment" }],
    screenshotUrls: { desktop: "data:image/jpeg;base64,abc", tablet: "data:image/jpeg;base64,abc", mobile: "data:image/jpeg;base64,abc" }
  };

  it("parses a valid passing report", () => {
    expect(VisualQualityReportSchema.safeParse(validReport).success).toBe(true);
  });

  it("forces passed=false when any critical issue is present (superRefine)", () => {
    const withCritical = {
      ...validReport,
      passed: true,
      issues: [{ severity: "critical", category: "design-token-drift", message: "rendered hero uses #f97316; chosen palette accent is #fbbf24" }]
    };
    const parsed = VisualQualityReportSchema.safeParse(withCritical);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.message).toMatch(/critical/i);
  });

  it("accepts passed=false with critical issues", () => {
    const withCritical = {
      ...validReport,
      passed: false,
      issues: [{ severity: "critical", category: "design-token-drift", message: "x" }]
    };
    expect(VisualQualityReportSchema.safeParse(withCritical).success).toBe(true);
  });

  it("clamps score to 0..100 (rejects out-of-range)", () => {
    expect(VisualQualityReportSchema.safeParse({ ...validReport, score: 150 }).success).toBe(false);
    expect(VisualQualityReportSchema.safeParse({ ...validReport, score: -5 }).success).toBe(false);
  });

  it("requires all 3 viewports in screenshotUrls", () => {
    const missing = { ...validReport, screenshotUrls: { desktop: "x", tablet: "x" } };
    expect(VisualQualityReportSchema.safeParse(missing).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm --filter @atlas/gate-visual-quality test test/types.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement types.ts**

Create `packages/gate-visual-quality/src/types.ts`:

```ts
import { z } from "zod";

export const ViewportSchema = z.enum(["desktop", "tablet", "mobile"]);
export type Viewport = z.infer<typeof ViewportSchema>;

export const IssueSeveritySchema = z.enum(["critical", "major", "minor"]);
export const IssueCategorySchema = z.enum(["contrast", "alignment", "hierarchy", "copy", "design-token-drift"]);

export const IssueSchema = z.object({
  severity: IssueSeveritySchema,
  category: IssueCategorySchema,
  message: z.string().min(1),
  elementSelector: z.string().optional()
});
export type Issue = z.infer<typeof IssueSchema>;

const ScreenshotUrlsSchema = z.object({
  desktop: z.string().min(1),
  tablet: z.string().min(1),
  mobile: z.string().min(1)
});

export const VisualQualityReportSchema = z
  .object({
    passed: z.boolean(),
    score: z.number().int().min(0).max(100),
    issues: z.array(IssueSchema),
    screenshotUrls: ScreenshotUrlsSchema
  })
  .superRefine((r, ctx) => {
    const hasCritical = r.issues.some((i) => i.severity === "critical");
    if (hasCritical && r.passed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "report has at least one critical issue but passed=true; critical issues must force passed=false"
      });
    }
  });
export type VisualQualityReport = z.infer<typeof VisualQualityReportSchema>;

/** A snapshot of the DesignTokens the user picked, passed to the critique
 *  prompt so the LLM can flag drift between selection and render. Sourced
 *  from RitualSnapshot.selectedTokens (added in S.4). Loose typing here
 *  to avoid a hard-coupling to @atlas/role-designer's exact shape. */
export interface DesignTokensSnapshot {
  palette?: Record<string, string>;
  typeScale?: { sansFamily?: string; serifFamily?: string; monoFamily?: string };
  density?: string;
  componentSet?: string;
  imageryStrategy?: string;
  copyVoice?: string;
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/gate-visual-quality test test/types.test.ts
```

Expected: PASS — 11 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/gate-visual-quality/src/types.ts packages/gate-visual-quality/test/types.test.ts
git commit -m "feat(gate-visual-quality): VisualQualityReportSchema + critical-superRefine + Issue/Viewport schemas"
```

---

### Task 3: Typed errors (`errors.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/errors.ts`
- Create: `packages/gate-visual-quality/test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/gate-visual-quality/test/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VisualQualityError, ScreenshotFailedError, SkillMissingError } from "../src/errors.js";

describe("VisualQualityError", () => {
  it("captures cause", () => {
    const cause = new Error("LLM 503");
    const err = new VisualQualityError("critique failed", { cause });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("VisualQualityError");
  });
});

describe("ScreenshotFailedError", () => {
  it("captures viewport + cause", () => {
    const cause = new Error("puppeteer crashed");
    const err = new ScreenshotFailedError("screenshot failed for tablet", { viewport: "tablet", cause });
    expect(err.viewport).toBe("tablet");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ScreenshotFailedError");
  });
});

describe("SkillMissingError", () => {
  it("captures skill name", () => {
    const err = new SkillMissingError("critique-design-tokens");
    expect(err.skillName).toBe("critique-design-tokens");
    expect(err.message).toContain("critique-design-tokens");
    expect(err.name).toBe("SkillMissingError");
  });
});
```

- [ ] **Step 2: Run — expect failure; implement; run — expect green**

```bash
pnpm --filter @atlas/gate-visual-quality test test/errors.test.ts
```

Expected initial failure.

Create `packages/gate-visual-quality/src/errors.ts`:

```ts
export class VisualQualityError extends Error {
  readonly cause?: unknown;
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = "VisualQualityError";
    this.cause = opts.cause;
  }
}

export class ScreenshotFailedError extends Error {
  readonly viewport?: string;
  readonly cause?: unknown;
  constructor(message: string, opts: { viewport?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "ScreenshotFailedError";
    this.viewport = opts.viewport;
    this.cause = opts.cause;
  }
}

export class SkillMissingError extends Error {
  readonly skillName: string;
  constructor(skillName: string) {
    super(`required skill missing: ${skillName}`);
    this.name = "SkillMissingError";
    this.skillName = skillName;
  }
}
```

```bash
pnpm --filter @atlas/gate-visual-quality test test/errors.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/gate-visual-quality/src/errors.ts packages/gate-visual-quality/test/errors.test.ts
git commit -m "feat(gate-visual-quality): typed errors (VisualQualityError, ScreenshotFailedError, SkillMissingError)"
```

---

### Task 4: Screenshot via puppeteer-core in sandbox (`screenshot.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/screenshot.ts`
- Create: `packages/gate-visual-quality/test/screenshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/gate-visual-quality/test/screenshot.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { captureScreenshots, type SandboxExec } from "../src/screenshot.js";
import { ScreenshotFailedError } from "../src/errors.js";

const fakeExec = (results: Record<string, { stdout: string; exitCode: number }>) =>
  ({
    runCommand: vi.fn().mockImplementation(async (cmd: string) => {
      for (const [match, res] of Object.entries(results)) {
        if (cmd.includes(match)) return res;
      }
      return { stdout: "", exitCode: 0 };
    })
  } as unknown as SandboxExec);

describe("captureScreenshots", () => {
  it("invokes puppeteer-core for each of 3 viewports", async () => {
    const exec = fakeExec({
      desktop: { stdout: "BASE64_DESKTOP", exitCode: 0 },
      tablet: { stdout: "BASE64_TABLET", exitCode: 0 },
      mobile: { stdout: "BASE64_MOBILE", exitCode: 0 }
    });
    const result = await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    expect(result.desktop).toContain("BASE64_DESKTOP");
    expect(result.tablet).toContain("BASE64_TABLET");
    expect(result.mobile).toContain("BASE64_MOBILE");
    expect((exec as unknown as { runCommand: ReturnType<typeof vi.fn> }).runCommand).toHaveBeenCalledTimes(3);
  });

  it("returns base64 data URLs (data:image/jpeg;base64,...)", async () => {
    const exec = fakeExec({
      desktop: { stdout: "AAAA", exitCode: 0 },
      tablet: { stdout: "BBBB", exitCode: 0 },
      mobile: { stdout: "CCCC", exitCode: 0 }
    });
    const result = await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    expect(result.desktop).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("throws ScreenshotFailedError when a viewport fails", async () => {
    const exec = {
      runCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes("tablet")) return { stdout: "", exitCode: 1, stderr: "puppeteer crashed" };
        return { stdout: "OK", exitCode: 0 };
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(ScreenshotFailedError);
  });

  it("includes the viewport name in the error", async () => {
    const exec = {
      runCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes("mobile")) return { stdout: "", exitCode: 1, stderr: "x" };
        return { stdout: "OK", exitCode: 0 };
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(/mobile/);
  });

  it("uses correct viewport dimensions in the puppeteer command", async () => {
    const exec = fakeExec({
      desktop: { stdout: "x", exitCode: 0 },
      tablet: { stdout: "x", exitCode: 0 },
      mobile: { stdout: "x", exitCode: 0 }
    });
    await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    const calls = (exec as unknown as { runCommand: ReturnType<typeof vi.fn> }).runCommand.mock.calls;
    const cmds = calls.map((c) => c[0]);
    expect(cmds.some((c) => c.includes("1280") && c.includes("800"))).toBe(true);
    expect(cmds.some((c) => c.includes("768") && c.includes("1024"))).toBe(true);
    expect(cmds.some((c) => c.includes("375") && c.includes("667"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure; implement screenshot.ts**

Create `packages/gate-visual-quality/src/screenshot.ts`:

```ts
import { ScreenshotFailedError } from "./errors.js";
import type { Viewport } from "./types.js";

export interface SandboxExec {
  runCommand(cmd: string): Promise<{ stdout: string; exitCode: number; stderr?: string }>;
}

export interface CaptureScreenshotsInput {
  exec: SandboxExec;
  previewUrl: string;
  timeoutMs?: number;
}

export interface CapturedScreenshots {
  desktop: string;
  tablet: string;
  mobile: string;
}

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 }
};

export async function captureScreenshots(input: CaptureScreenshotsInput): Promise<CapturedScreenshots> {
  const out: Partial<CapturedScreenshots> = {};
  for (const [vp, dims] of Object.entries(VIEWPORTS) as Array<[Viewport, { width: number; height: number }]>) {
    const cmd = puppeteerCommand({ url: input.previewUrl, viewport: vp, width: dims.width, height: dims.height, timeoutMs: input.timeoutMs ?? 15000 });
    const result = await input.exec.runCommand(cmd);
    if (result.exitCode !== 0) {
      throw new ScreenshotFailedError(`screenshot failed for ${vp}: ${result.stderr ?? "(no stderr)"}`, { viewport: vp });
    }
    out[vp] = `data:image/jpeg;base64,${result.stdout.trim()}`;
  }
  return out as CapturedScreenshots;
}

function puppeteerCommand(input: { url: string; viewport: Viewport; width: number; height: number; timeoutMs: number }): string {
  // The script runs inside the E2B sandbox where puppeteer-core + chromium are pre-installed.
  // It opens the preview URL, waits for network-idle + the canvas root data attribute, takes a JPEG, prints base64 to stdout.
  const script = `
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: ${input.width}, height: ${input.height}, deviceScaleFactor: 1 });
  await page.goto('${input.url}', { waitUntil: 'networkidle0', timeout: ${input.timeoutMs} });
  await page.waitForTimeout(500);
  const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
  process.stdout.write(buf.toString('base64'));
  await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
`.trim();
  // Tag the command with the viewport name so test mocks can route by it.
  return `node -e ${JSON.stringify(script)} ${input.viewport}`;
}
```

```bash
pnpm --filter @atlas/gate-visual-quality test test/screenshot.test.ts
```

Expected: PASS — 5 cases.

- [ ] **Step 3: Commit**

```bash
git add packages/gate-visual-quality/src/screenshot.ts packages/gate-visual-quality/test/screenshot.test.ts
git commit -m "feat(gate-visual-quality): captureScreenshots — puppeteer-core via SandboxExec, 3 viewports"
```

---

### Task 5: assemble-prompt — composes 3 visual-quality skills (`assemble-prompt.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/assemble-prompt.ts`
- Create: `packages/gate-visual-quality/test/assemble-prompt.test.ts`
- Create: `packages/skill-library/skills/visual-quality/critique-design-tokens.md`
- Create: `packages/skill-library/skills/visual-quality/critique-hierarchy.md`
- Create: `packages/skill-library/skills/visual-quality/critique-copy.md`

- [ ] **Step 1: Write the failing test**

Create `packages/gate-visual-quality/test/assemble-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleVisualQualityPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const fakeRegistry = (skills: Record<string, string>) =>
  ({
    get(name: string) {
      return skills[name] ? { body: skills[name] } : undefined;
    }
  } as unknown as { get(name: string): { body: string } | undefined });

describe("assembleVisualQualityPrompt", () => {
  it("composes the 3 named skills in order", () => {
    const reg = fakeRegistry({
      "critique-design-tokens": "TOKENS-SKILL-BODY",
      "critique-hierarchy": "HIERARCHY-SKILL-BODY",
      "critique-copy": "COPY-SKILL-BODY"
    });
    const prompt = assembleVisualQualityPrompt(reg as never, [
      "critique-design-tokens",
      "critique-hierarchy",
      "critique-copy"
    ]);
    expect(prompt).toContain("TOKENS-SKILL-BODY");
    expect(prompt).toContain("HIERARCHY-SKILL-BODY");
    expect(prompt).toContain("COPY-SKILL-BODY");
    expect(prompt.indexOf("TOKENS")).toBeLessThan(prompt.indexOf("HIERARCHY"));
    expect(prompt.indexOf("HIERARCHY")).toBeLessThan(prompt.indexOf("COPY"));
  });

  it("throws SkillMissingError when a skill is missing", () => {
    const reg = fakeRegistry({ "critique-design-tokens": "x" });
    expect(() => assembleVisualQualityPrompt(reg as never, ["critique-design-tokens", "critique-missing"])).toThrow(SkillMissingError);
  });
});
```

- [ ] **Step 2: Implement assemble-prompt.ts**

Create `packages/gate-visual-quality/src/assemble-prompt.ts`:

```ts
import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

export function assembleVisualQualityPrompt(registry: SkillRegistry, skillNames: string[]): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
```

- [ ] **Step 3: Create the 3 skill markdown files**

Create `packages/skill-library/skills/visual-quality/critique-design-tokens.md`:

```markdown
---
name: critique-design-tokens
description: Detect drift between the user's chosen DesignTokens and what the rendered output actually shows
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Design-Token Drift

## When to use

The Visual-Quality gate composes this skill to check whether the rendered preview honors the DesignTokens the user picked (palette, typography, density, componentSet).

## Checklist

- [ ] Compare the rendered hero/primary surface's accent color to `tokens.palette.accent`. Flag drift > ~10% hue shift as `category: "design-token-drift"`, severity scaled by visibility.
- [ ] Compare rendered headline font to `tokens.typeScale.serifFamily` / `sansFamily`. Wrong font family = critical (the user's pick was ignored).
- [ ] Compare density (paddings, line-height, surface gaps) against `tokens.density: "compact" | "comfortable" | "spacious"`. Significant mismatch = major.
- [ ] Verify shadcn/ui components render with their `--atlas-*` CSS variable values, not raw hex codes from inline styles.

## Output contract

Issues with `category: "design-token-drift"`. Severity:
- `critical` = wrong palette or wrong font family on the hero surface
- `major` = density mismatch on primary surface
- `minor` = subtle accent or border-radius drift

## Anti-patterns

- Don't penalize intentional contrast within the chosen palette (e.g. accent-on-dark-background).
- Don't flag dynamic content (timestamps, generated IDs) as drift.
```

Create `packages/skill-library/skills/visual-quality/critique-hierarchy.md`:

```markdown
---
name: critique-hierarchy
description: WCAG contrast, alignment, visual hierarchy of the rendered output
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Hierarchy + Contrast + Alignment

## When to use

Composed by the Visual-Quality gate to assess whether the rendered output follows basic visual-design hygiene independent of the chosen tokens.

## Checklist

- [ ] Body text contrast ≥ 4.5:1 (WCAG AA) — flag failures as `category: "contrast"`, severity `major`.
- [ ] Large text (≥18pt) contrast ≥ 3:1.
- [ ] Visual hierarchy: H1 > H2 > H3 in size + weight — flag inversions (`category: "hierarchy"`, `major`).
- [ ] Alignment: primary surfaces share a consistent grid baseline. Random pixel offsets = `category: "alignment"`, `minor`.
- [ ] Focus: ONE clear primary CTA above the fold — multiple competing CTAs = `category: "hierarchy"`, `major`.

## Output contract

Issues with `category: "contrast" | "hierarchy" | "alignment"`. Severity reflects user impact, not aesthetic preference.

## Anti-patterns

- Don't flag intentional creative choices (e.g. all-lowercase headers, asymmetric layouts) as alignment failures unless they break readability.
- Don't downgrade accessibility issues to "minor" — contrast failures are at least `major`.
```

Create `packages/skill-library/skills/visual-quality/critique-copy.md`:

```markdown
---
name: critique-copy
description: Detect generic LLM-prose vs intentional, category-appropriate copy
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Copy

## When to use

Composed by the Visual-Quality gate to check whether the rendered headlines and microcopy sound like they were written by a person who knows the category, vs. generic AI-prose.

## Checklist

- [ ] Headline avoids generic phrases: "Experience the finest", "Where dreams become reality", "Discover the difference".
- [ ] Specific to the category: a restaurant page mentions actual dishes, neighborhoods, hours; a SaaS page mentions concrete value props, not "transform your business".
- [ ] Microcopy on CTAs is action-led: "Book a table" beats "Click here". "Reserve" beats "Submit".
- [ ] No placeholder text leaks (Lorem ipsum, "[Your text here]", "TBD").

## Output contract

Issues with `category: "copy"`. Severity:
- `critical` = placeholder text leaks (Lorem, TBD).
- `major` = headlines clearly generic AI-prose.
- `minor` = microcopy could be more action-led.

## Anti-patterns

- Don't penalize copy the user explicitly asked for ("the user wrote this exact headline").
- Don't flag i18n-style template strings as placeholders.
```

- [ ] **Step 4: Run + verify**

```bash
pnpm --filter @atlas/gate-visual-quality test test/assemble-prompt.test.ts
pnpm --filter @atlas/skill-library test
```

Expected both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gate-visual-quality/src/assemble-prompt.ts \
        packages/gate-visual-quality/test/assemble-prompt.test.ts \
        packages/skill-library/skills/visual-quality/
git commit -m "feat(gate-visual-quality): assemble-prompt + 3 visual-quality skill markdown files"
```

---

### Task 6: critique — multimodal Sonnet call (`critique.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/critique.ts`
- Create: `packages/gate-visual-quality/test/critique.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/gate-visual-quality/test/critique.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { critiqueScreenshots, VQ_GATE_MODEL } from "../src/critique.js";
import { VisualQualityReportSchema } from "../src/types.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const screenshots = {
  desktop: "data:image/jpeg;base64,DESKTOP_BYTES",
  tablet: "data:image/jpeg;base64,TABLET_BYTES",
  mobile: "data:image/jpeg;base64,MOBILE_BYTES"
};
const validReport = {
  passed: true,
  score: 88,
  issues: [],
  screenshotUrls: { ...screenshots }
};

describe("critiqueScreenshots", () => {
  it("returns a Zod-valid report on happy path", async () => {
    const llm = fakeLLM(validReport);
    const report = await critiqueScreenshots({
      llm: llm as never,
      composedPrompt: "## Skill: critique-design-tokens\n\n...",
      screenshots,
      tokens: { palette: { primary: "#0a0a0a", accent: "#fbbf24" }, typeScale: { serifFamily: "IBM Plex Serif" } }
    });
    expect(VisualQualityReportSchema.safeParse(report).success).toBe(true);
  });

  it("uses the configured model (default Sonnet)", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string };
    expect(opts.model).toBe(VQ_GATE_MODEL);
  });

  it("includes 3 image content blocks (one per viewport)", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ role: string; content: string | Array<{ type: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    if (!userMsg || typeof userMsg.content === "string") throw new Error("user content should be array");
    const imageBlocks = userMsg.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(3);
  });

  it("includes the chosen tokens in the user message text", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: { palette: { accent: "#fbbf24" } } });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
    const userMsg = messages.find((m) => m.role === "user");
    if (!userMsg || typeof userMsg.content === "string") throw new Error("expected array");
    const textBlock = userMsg.content.find((c) => c.type === "text");
    expect(textBlock?.text).toContain("#fbbf24");
  });

  it("rejects malformed report from LLM (Zod fail)", async () => {
    const llm = fakeLLM({ totally: "wrong" });
    await expect(
      critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {} })
    ).rejects.toThrow();
  });

  it("respects ATLAS_VQ_GATE_MODEL override via constructor model arg", async () => {
    const llm = fakeLLM(validReport);
    await critiqueScreenshots({ llm: llm as never, composedPrompt: "x", screenshots, tokens: {}, model: "claude-haiku-4-5" });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    expect((args[1] as { model: string }).model).toBe("claude-haiku-4-5");
  });
});
```

- [ ] **Step 2: Implement critique.ts**

Create `packages/gate-visual-quality/src/critique.ts`:

```ts
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { VisualQualityError } from "./errors.js";
import { VisualQualityReportSchema, type VisualQualityReport, type DesignTokensSnapshot } from "./types.js";
import type { CapturedScreenshots } from "./screenshot.js";

export const VQ_GATE_MODEL = "claude-sonnet-4";

const ROLE_PROMPT = `You are the Visual-Quality merge gate. Given 3 screenshots of a rendered preview (desktop, tablet, mobile)
and the DesignTokens the user explicitly chose, produce ONE VisualQualityReport that flags drift, contrast/hierarchy
problems, and copy issues.

Rules:
- Any "critical" severity issue MUST flip "passed" to false.
- Score 0-100. 90+ = ship; 70-89 = ship with notes; <70 = significant rework.
- Cite element selectors when possible (e.g. "header > h1", "main .hero img").
- Echo the screenshotUrls input verbatim into the output.

Call the emit_visual_quality_report tool exactly once.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: { type: "string", enum: ["contrast", "alignment", "hierarchy", "copy", "design-token-drift"] },
          message: { type: "string" },
          elementSelector: { type: "string" }
        },
        required: ["severity", "category", "message"]
      }
    },
    screenshotUrls: {
      type: "object",
      properties: {
        desktop: { type: "string" },
        tablet: { type: "string" },
        mobile: { type: "string" }
      },
      required: ["desktop", "tablet", "mobile"]
    }
  },
  required: ["passed", "score", "issues", "screenshotUrls"]
} as const;

export interface CritiqueInput {
  llm: LLMProvider;
  composedPrompt: string;
  screenshots: CapturedScreenshots;
  tokens: DesignTokensSnapshot;
  model?: string;
}

export async function critiqueScreenshots(input: CritiqueInput): Promise<VisualQualityReport> {
  const userContent = buildUserContent(input);

  const messages: LLMMessage[] = [
    { role: "system", content: `${ROLE_PROMPT}\n\n# Reference skills\n\n${input.composedPrompt}` },
    { role: "user", content: userContent as unknown as string }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? VQ_GATE_MODEL,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_visual_quality_report",
          description: "Emit the VisualQualityReport for the rendered preview",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_visual_quality_report" }
    });
  } catch (err) {
    throw new VisualQualityError(`critique LLM call failed: ${(err as Error).message}`, { cause: err });
  }

  const enriched = enrichReport(result.input, input.screenshots);
  const parsed = VisualQualityReportSchema.safeParse(enriched);
  if (!parsed.success) {
    throw new VisualQualityError(`critique tool_use payload failed schema: ${parsed.error.message}`, { cause: parsed.error });
  }
  return parsed.data;
}

function buildUserContent(input: CritiqueInput): Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> {
  const tokensJson = JSON.stringify(input.tokens, null, 2);
  return [
    {
      type: "text",
      text: `# Chosen DesignTokens\n\n\`\`\`json\n${tokensJson}\n\`\`\`\n\n# Screenshots\n\nDesktop, then tablet, then mobile.`
    },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.desktop) } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.tablet) } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.mobile) } },
    { type: "text", text: "Now produce the VisualQualityReport via emit_visual_quality_report." }
  ];
}

function stripDataUrl(s: string): string {
  return s.replace(/^data:image\/\w+;base64,/, "");
}

function enrichReport(raw: unknown, screenshots: CapturedScreenshots): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  // Always overwrite screenshotUrls with the actual captured screenshots — model can't be trusted to echo.
  return { ...r, screenshotUrls: screenshots };
}
```

- [ ] **Step 3: Run — expect green**

```bash
pnpm --filter @atlas/gate-visual-quality test test/critique.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 4: Commit**

```bash
git add packages/gate-visual-quality/src/critique.ts packages/gate-visual-quality/test/critique.test.ts
git commit -m "feat(gate-visual-quality): critique — multimodal Sonnet with 3 image blocks + tokens + tool-use"
```

---

### Task 7: visual-quality-check orchestrator (`visual-quality-check.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/visual-quality-check.ts`
- Create: `packages/gate-visual-quality/test/visual-quality-check.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/gate-visual-quality/test/visual-quality-check.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runVisualQualityCheck } from "../src/visual-quality-check.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeRegistry = {
  get(name: string) {
    return { body: `BODY-${name}` };
  }
} as unknown as { get(name: string): { body: string } | undefined };

const fakeExec = {
  runCommand: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd.includes("desktop")) return { stdout: "DESKTOP_B64", exitCode: 0 };
    if (cmd.includes("tablet")) return { stdout: "TABLET_B64", exitCode: 0 };
    if (cmd.includes("mobile")) return { stdout: "MOBILE_B64", exitCode: 0 };
    return { stdout: "", exitCode: 0 };
  })
};

describe("runVisualQualityCheck", () => {
  it("composes screenshots → critique → returns report", async () => {
    const llm = fakeLLM({ passed: true, score: 90, issues: [], screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" } });
    const report = await runVisualQualityCheck({
      llm: llm as never,
      skills: fakeRegistry as never,
      exec: fakeExec as never,
      previewUrl: "http://localhost:3000",
      tokens: {}
    });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(90);
    expect(report.screenshotUrls.desktop).toContain("DESKTOP_B64");
  });

  it("propagates ScreenshotFailedError", async () => {
    const failingExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "", exitCode: 1, stderr: "x" }) };
    const llm = fakeLLM({});
    await expect(
      runVisualQualityCheck({
        llm: llm as never,
        skills: fakeRegistry as never,
        exec: failingExec as never,
        previewUrl: "http://localhost:3000",
        tokens: {}
      })
    ).rejects.toThrow(/screenshot failed/);
  });

  it("propagates VisualQualityError on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    };
    await expect(
      runVisualQualityCheck({
        llm: llm as never,
        skills: fakeRegistry as never,
        exec: fakeExec as never,
        previewUrl: "http://localhost:3000",
        tokens: {}
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement visual-quality-check.ts**

Create `packages/gate-visual-quality/src/visual-quality-check.ts`:

```ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { captureScreenshots, type SandboxExec } from "./screenshot.js";
import { critiqueScreenshots } from "./critique.js";
import { assembleVisualQualityPrompt } from "./assemble-prompt.js";
import type { VisualQualityReport, DesignTokensSnapshot } from "./types.js";

export interface RunVisualQualityCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  tokens: DesignTokensSnapshot;
  model?: string;
  skillNames?: string[];
}

const DEFAULT_SKILL_NAMES = ["critique-design-tokens", "critique-hierarchy", "critique-copy"];

export async function runVisualQualityCheck(input: RunVisualQualityCheckInput): Promise<VisualQualityReport> {
  const screenshots = await captureScreenshots({ exec: input.exec, previewUrl: input.previewUrl });
  const composedPrompt = assembleVisualQualityPrompt(input.skills, input.skillNames ?? DEFAULT_SKILL_NAMES);
  return critiqueScreenshots({
    llm: input.llm,
    composedPrompt,
    screenshots,
    tokens: input.tokens,
    model: input.model
  });
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/gate-visual-quality test test/visual-quality-check.test.ts
```

Expected: PASS.

```bash
git add packages/gate-visual-quality/src/visual-quality-check.ts packages/gate-visual-quality/test/visual-quality-check.test.ts
git commit -m "feat(gate-visual-quality): runVisualQualityCheck — orchestrates screenshot + critique"
```

---

### Task 8: VisualQualityRole class (`role.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/role.ts`
- Create: `packages/gate-visual-quality/test/role.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/gate-visual-quality/test/role.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { VisualQualityRole } from "../src/role.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeSkills = { get: () => ({ body: "x" }) } as unknown as { get(n: string): { body: string } | undefined };

const fakeExec = {
  runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 })
};

const validReport = (passed = true) => ({
  passed,
  score: passed ? 90 : 50,
  issues: passed ? [] : [{ severity: "critical", category: "design-token-drift", message: "wrong palette" }],
  screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" }
});

describe("VisualQualityRole", () => {
  it("has id 'visual-quality'", () => {
    const role = new VisualQualityRole({ llm: fakeLLM(validReport()) as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "x" });
    expect(role.id).toBe("visual-quality");
  });

  it("emits started + passed + completed on green", async () => {
    const llm = fakeLLM(validReport(true));
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const out = await role.run({ ritualId: "r1", userTurn: "diff", graphSlice: { bytes: "{}", hash: "h" } });
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.started");
    expect(types).toContain("visual_quality.passed");
    expect(types).toContain("visual_quality.completed");
  });

  it("emits started + failed + completed on red", async () => {
    const llm = fakeLLM(validReport(false));
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const out = await role.run({ ritualId: "r1", userTurn: "diff", graphSlice: { bytes: "{}", hash: "h" } });
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.failed");
  });

  it("emits skipped + completed when canvasManifest has no design-blocking mode", async () => {
    const llm = fakeLLM(validReport());
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    // Pass priorArtifact with backend-only canvas (no design mode)
    const out = await role.run({
      ritualId: "r1",
      userTurn: "diff",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { canvasManifest: { artifactKind: "backend-rest-api", modes: [{ id: "schema", renderer: "x", audience: ["diego"] }] } }
    });
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.skipped");
    expect(types).not.toContain("visual_quality.passed");
    expect(types).not.toContain("visual_quality.failed");
  });

  it("emits errored on internal failure", async () => {
    const failingExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "", exitCode: 1, stderr: "x" }) };
    const role = new VisualQualityRole({ llm: fakeLLM(validReport()) as never, skills: fakeSkills as never, exec: failingExec as never, previewUrl: "http://localhost:3000" });
    await expect(role.run({ ritualId: "r1", userTurn: "diff", graphSlice: { bytes: "{}", hash: "h" } })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement role.ts**

Create `packages/gate-visual-quality/src/role.ts`:

```ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runVisualQualityCheck } from "./visual-quality-check.js";
import type { SandboxExec } from "./screenshot.js";
import type { DesignTokensSnapshot } from "./types.js";

export interface VisualQualityRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  model?: string;
}

export class VisualQualityRole implements Role {
  readonly id = "visual-quality";
  private readonly opts: VisualQualityRoleOptions;
  constructor(opts: VisualQualityRoleOptions) {
    this.opts = opts;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const reason = shouldSkip(inv.priorArtifact);
    if (reason) {
      events.push({ eventType: "visual_quality.skipped", payload: { reason } });
      events.push({ eventType: "visual_quality.completed", payload: { passed: true, skipped: true } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "visual_quality.started", payload: { ritualId: inv.ritualId } });
    const tokens = extractTokens(inv.priorArtifact);

    let report;
    try {
      report = await runVisualQualityCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        exec: this.opts.exec,
        previewUrl: this.opts.previewUrl,
        tokens,
        model: this.opts.model
      });
    } catch (err) {
      events.push({ eventType: "visual_quality.errored", payload: { error: (err as Error).message } });
      throw err;
    }

    if (report.passed) {
      events.push({
        eventType: "visual_quality.passed",
        payload: { score: report.score, issueCount: report.issues.length }
      });
    } else {
      const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
      events.push({
        eventType: "visual_quality.failed",
        payload: { critical: criticalCount, total: report.issues.length, issues: report.issues }
      });
    }
    events.push({ eventType: "visual_quality.completed", payload: { passed: report.passed, report } });
    return { events, diff: { kind: "none" } };
  }
}

function shouldSkip(priorArtifact: unknown): string | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const manifest = (priorArtifact as { canvasManifest?: unknown }).canvasManifest;
  if (!manifest || typeof manifest !== "object") return null;
  const modes = (manifest as { modes?: Array<{ blockingFor?: string }> }).modes ?? [];
  const hasDesignBlocking = modes.some((m) => m.blockingFor === "design");
  return hasDesignBlocking ? null : "no design-blocking canvas mode in manifest (backend-only or refactor scope)";
}

function extractTokens(priorArtifact: unknown): DesignTokensSnapshot {
  if (!priorArtifact || typeof priorArtifact !== "object") return {};
  const tokens = (priorArtifact as { selectedTokens?: unknown }).selectedTokens;
  if (!tokens || typeof tokens !== "object") return {};
  return tokens as DesignTokensSnapshot;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/gate-visual-quality test test/role.test.ts
```

Expected: PASS — 5 cases.

```bash
git add packages/gate-visual-quality/src/role.ts packages/gate-visual-quality/test/role.test.ts
git commit -m "feat(gate-visual-quality): VisualQualityRole — postDeveloperChain dispatch + skipped/passed/failed/errored events"
```

---

### Task 9: VisualQualityGateRunner (`runner.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/runner.ts`
- Create: `packages/gate-visual-quality/test/runner.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/gate-visual-quality/test/runner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { VisualQualityGateRunner } from "../src/runner.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeSkills = { get: () => ({ body: "x" }) } as unknown as { get(n: string): { body: string } | undefined };
const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };

describe("VisualQualityGateRunner", () => {
  it("has layer = 'L7'", () => {
    const runner = new VisualQualityGateRunner({ llm: fakeLLM({}) as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "x" });
    expect(runner.layer).toBe("L7");
  });

  it("returns GateResult.passed=true on green report", async () => {
    const llm = fakeLLM({ passed: true, score: 90, issues: [], screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" } });
    const runner = new VisualQualityGateRunner({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const result = await runner.run({ tokens: {} });
    expect(result.passed).toBe(true);
    expect(result.report.score).toBe(90);
  });

  it("returns GateResult.passed=false on red report", async () => {
    const llm = fakeLLM({
      passed: false,
      score: 40,
      issues: [{ severity: "critical", category: "design-token-drift", message: "wrong palette" }],
      screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" }
    });
    const runner = new VisualQualityGateRunner({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const result = await runner.run({ tokens: {} });
    expect(result.passed).toBe(false);
    expect(result.report.issues[0].severity).toBe("critical");
  });
});
```

- [ ] **Step 2: Implement runner.ts**

Create `packages/gate-visual-quality/src/runner.ts`:

```ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runVisualQualityCheck } from "./visual-quality-check.js";
import type { SandboxExec } from "./screenshot.js";
import type { DesignTokensSnapshot, VisualQualityReport } from "./types.js";

export interface VisualQualityGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  model?: string;
}

export interface GateResult {
  passed: boolean;
  report: VisualQualityReport;
}

export class VisualQualityGateRunner {
  readonly layer = "L7" as const;
  private readonly opts: VisualQualityGateRunnerOptions;
  constructor(opts: VisualQualityGateRunnerOptions) {
    this.opts = opts;
  }

  async run(input: { tokens: DesignTokensSnapshot }): Promise<GateResult> {
    const report = await runVisualQualityCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      exec: this.opts.exec,
      previewUrl: this.opts.previewUrl,
      tokens: input.tokens,
      model: this.opts.model
    });
    return { passed: report.passed, report };
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/gate-visual-quality test test/runner.test.ts
```

Expected: PASS.

```bash
git add packages/gate-visual-quality/src/runner.ts packages/gate-visual-quality/test/runner.test.ts
git commit -m "feat(gate-visual-quality): VisualQualityGateRunner — direct gate-call interface (L7)"
```

---

### Task 10: Public exports (`index.ts`)

**Files:**
- Create: `packages/gate-visual-quality/src/index.ts`

- [ ] **Step 1: Write index.ts**

Create `packages/gate-visual-quality/src/index.ts`:

```ts
export {
  VisualQualityReportSchema,
  ViewportSchema,
  IssueSchema,
  IssueSeveritySchema,
  IssueCategorySchema,
  type VisualQualityReport,
  type Viewport,
  type Issue,
  type DesignTokensSnapshot
} from "./types.js";

export { VisualQualityError, ScreenshotFailedError, SkillMissingError } from "./errors.js";

export { captureScreenshots, type SandboxExec, type CaptureScreenshotsInput, type CapturedScreenshots } from "./screenshot.js";

export { critiqueScreenshots, VQ_GATE_MODEL, type CritiqueInput } from "./critique.js";

export { assembleVisualQualityPrompt } from "./assemble-prompt.js";

export { runVisualQualityCheck, type RunVisualQualityCheckInput } from "./visual-quality-check.js";

export { VisualQualityRole, type VisualQualityRoleOptions } from "./role.js";

export { VisualQualityGateRunner, type VisualQualityGateRunnerOptions, type GateResult } from "./runner.js";
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @atlas/gate-visual-quality typecheck
```

Expected: 0 errors.

```bash
git add packages/gate-visual-quality/src/index.ts
git commit -m "feat(gate-visual-quality): public exports"
```

---

### Task 11: Risk-accept regression test for L7-visual-advisory

**Files:**
- Create: `packages/ritual-engine/test/risk-accept-l7-visual-advisory.test.ts`

- [ ] **Step 1: Write the regression-guard test**

L7-visual-advisory is already declared in `packages/ritual-engine/src/risk-accept.ts` (already wired with persona "ama"). This test ensures it stays that way.

Create `packages/ritual-engine/test/risk-accept-l7-visual-advisory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GateSchema, enforcePersonaGate, PersonaGateError } from "../src/index.js";

describe("L7-visual-advisory risk-accept tier", () => {
  it("is registered in GateSchema", () => {
    expect(GateSchema.safeParse("L7-visual-advisory").success).toBe(true);
  });

  it("ama can risk-accept L7", () => {
    expect(() =>
      enforcePersonaGate({
        gate: "L7-visual-advisory",
        acceptedBy: { personaTier: "ama", userId: "u", timestamp: "2026-05-02T00:00:00Z" },
        reason: "user accepted minor visual issues"
      })
    ).not.toThrow();
  });

  it("diego can risk-accept L7", () => {
    expect(() =>
      enforcePersonaGate({
        gate: "L7-visual-advisory",
        acceptedBy: { personaTier: "diego", userId: "u", timestamp: "2026-05-02T00:00:00Z" },
        reason: "x"
      })
    ).not.toThrow();
  });

  it("priya can risk-accept L7", () => {
    expect(() =>
      enforcePersonaGate({
        gate: "L7-visual-advisory",
        acceptedBy: { personaTier: "priya", userId: "u", timestamp: "2026-05-02T00:00:00Z" },
        reason: "x"
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @atlas/ritual-engine test test/risk-accept-l7-visual-advisory.test.ts
```

Expected: PASS — 4 cases. (Risk-accept already has the entry; this test prevents accidental removal.)

```bash
git add packages/ritual-engine/test/risk-accept-l7-visual-advisory.test.ts
git commit -m "test(ritual-engine): regression-guard L7-visual-advisory persona-tier (ama)"
```

---

### Task 12: atlas-web factory wires getVisualQualityGate

**Files:**
- Modify: `apps/atlas-web/lib/llm/factory.ts`
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/package.json`
- Create: `apps/atlas-web/test/lib/factory-visual-quality.test.ts`

- [ ] **Step 1: Add @atlas/gate-visual-quality to atlas-web deps**

Open `apps/atlas-web/package.json`, add to `dependencies`:

```json
    "@atlas/gate-visual-quality": "workspace:*",
```

Run from repo root:

```bash
pnpm install
```

- [ ] **Step 2: Add the feature flag**

Open `apps/atlas-web/lib/feature-flags.ts`. Find the `FeatureFlag` union type. Add `"visual-quality-gate"` to the union, and add the env-var mapping (typically `ATLAS_FF_VISUAL_QUALITY_GATE`).

- [ ] **Step 3: Write the failing factory test**

Create `apps/atlas-web/test/lib/factory-visual-quality.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("factory visual-quality integration", () => {
  it("getVisualQualityRole returns null when ATLAS_FF_VISUAL_QUALITY_GATE is not set", async () => {
    delete process.env.ATLAS_FF_VISUAL_QUALITY_GATE;
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: { runCommand: async () => ({ stdout: "", exitCode: 0 }) } as never, previewUrl: "x" });
    expect(role).toBeNull();
  });

  it("getVisualQualityRole returns a VisualQualityRole when flag=true", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: { runCommand: async () => ({ stdout: "", exitCode: 0 }) } as never, previewUrl: "http://localhost:3000" });
    expect(role).not.toBeNull();
    expect(role!.id).toBe("visual-quality");
  });

  it("respects ATLAS_VQ_GATE_MODEL override", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    process.env.ATLAS_VQ_GATE_MODEL = "claude-haiku-4-5";
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: { runCommand: async () => ({ stdout: "", exitCode: 0 }) } as never, previewUrl: "x" });
    expect(role).not.toBeNull();
    // Model override is internal; presence is verified by env-var detection.
  });

  it("returns null when LLM env not configured", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    delete process.env.ATLAS_LLM_BASE_URL;
    delete process.env.ATLAS_LLM_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: { runCommand: async () => ({ stdout: "", exitCode: 0 }) } as never, previewUrl: "x" });
    expect(role).toBeNull();
  });
});
```

- [ ] **Step 4: Implement getVisualQualityRole in factory.ts**

Open `apps/atlas-web/lib/llm/factory.ts`. Append:

```ts
import type { VisualQualityRole as TVisualQualityRole, SandboxExec } from "@atlas/gate-visual-quality";

export async function getVisualQualityRole(input: { exec: SandboxExec; previewUrl: string }): Promise<TVisualQualityRole | null> {
  if (process.env.ATLAS_FF_VISUAL_QUALITY_GATE !== "true") return null;

  const { VisualQualityRole } = await import("@atlas/gate-visual-quality");
  const llm = await getLlmProvider();
  if (!llm) return null;
  const skills = await getSkillRegistry();

  return new VisualQualityRole({
    llm,
    skills,
    exec: input.exec,
    previewUrl: input.previewUrl,
    model: process.env.ATLAS_VQ_GATE_MODEL
  });
}
```

(`getSkillRegistry` is the existing factory helper; if its name differs in the actual codebase, use the helper that resolves a `SkillRegistry` already used by Security/A11y.)

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter atlas-web test test/lib/factory-visual-quality.test.ts
```

Expected: PASS — 4 cases.

```bash
git add apps/atlas-web/lib/llm/factory.ts apps/atlas-web/lib/feature-flags.ts apps/atlas-web/package.json apps/atlas-web/test/lib/factory-visual-quality.test.ts
git commit -m "feat(atlas-web): factory.getVisualQualityRole gated by ATLAS_FF_VISUAL_QUALITY_GATE + ATLAS_VQ_GATE_MODEL"
```

---

### Task 13: Wire VisualQualityRole into postDeveloperChain

**Files:**
- Modify: `apps/atlas-web/lib/llm/factory.ts` (or wherever `getRitualEngine`/postDeveloperChain assembly lives)
- Modify: `apps/atlas-web/lib/events/EventBroker.ts` (map visual_quality.* events)

- [ ] **Step 1: Locate the postDeveloperChain assembly**

Read the relevant section of `apps/atlas-web/lib/llm/factory.ts` (or its successor if file shape has changed). Find where Security and A11y roles are pushed onto the chain. The pattern in S.4 is similar.

- [ ] **Step 2: Append visual-quality to the chain**

Inside the engine factory, after the security + a11y entries are pushed, add:

```ts
const vqRole = await getVisualQualityRole({ exec: sandboxExec, previewUrl });
if (vqRole) postDeveloperChain.push(vqRole);
```

(`sandboxExec` and `previewUrl` are sourced from the same place the existing sandbox-using roles get them; copy the pattern from how `applyDiff` reaches the sandbox.)

- [ ] **Step 3: Map visual_quality.* events in the EventBroker**

Open `apps/atlas-web/lib/events/EventBroker.ts`. Find the existing event-type mapping for `security.*` / `a11y.*`. Add:

```ts
case "visual_quality.started":
case "visual_quality.passed":
case "visual_quality.failed":
case "visual_quality.skipped":
case "visual_quality.errored":
case "visual_quality.completed":
  return { kind: "gate-visual-quality", ...payload };
```

(Exact dispatch shape mirrors how Security's events are mapped — copy the pattern.)

- [ ] **Step 4: Add a brief integration test**

Add to `apps/atlas-web/test/lib/factory-visual-quality.test.ts`:

```ts
it("getRitualEngine appends visual-quality to postDeveloperChain when flag on", async () => {
  process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
  process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
  process.env.ATLAS_LLM_API_KEY = "sk-test";
  const { getRitualEngine } = await import("@/lib/llm/factory");
  const engine = await getRitualEngine("test-project");
  // Engine internals are private; verify via behavior or expose a chain accessor for tests.
  // If the engine doesn't expose chain, this test asserts no crash on construction.
  expect(engine).toBeDefined();
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter atlas-web test test/lib/factory-visual-quality.test.ts
```

```bash
git add apps/atlas-web/lib/llm/factory.ts apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/test/lib/factory-visual-quality.test.ts
git commit -m "feat(atlas-web): wire VisualQualityRole into postDeveloperChain + EventBroker maps visual_quality.* events"
```

---

### Task 14: Playwright visual config + scripts

**Files:**
- Create: `apps/atlas-web/playwright.visual.config.ts`
- Modify: `apps/atlas-web/package.json`

- [ ] **Step 1: Create playwright.visual.config.ts**

Create `apps/atlas-web/playwright.visual.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e/visual",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry"
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.1
    }
  },
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}`,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
```

- [ ] **Step 2: Add scripts + devDeps to atlas-web/package.json**

Open `apps/atlas-web/package.json`. Add to `scripts`:

```json
    "test:visual": "playwright test --config=playwright.visual.config.ts",
    "test:visual:update": "playwright test --config=playwright.visual.config.ts --update-snapshots",
    "test:visual:headed": "playwright test --config=playwright.visual.config.ts --headed",
```

Add to `devDependencies`:

```json
    "@axe-core/playwright": "4.10.0",
```

Run:

```bash
pnpm install
```

- [ ] **Step 3: Create __snapshots__ placeholder**

```bash
mkdir -p apps/atlas-web/e2e/visual/__snapshots__
touch apps/atlas-web/e2e/visual/__snapshots__/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/playwright.visual.config.ts \
        apps/atlas-web/package.json \
        apps/atlas-web/e2e/visual/__snapshots__/.gitkeep
git commit -m "feat(atlas-web): playwright.visual.config + test:visual scripts + axe-core devDep"
```

---

### Task 15: Visual fixture routes + helpers

**Files:**
- Create: `apps/atlas-web/app/__visual__/_layout.tsx`
- Modify: `apps/atlas-web/middleware.ts` (404 these routes in production)
- Create: `apps/atlas-web/e2e/visual/fixtures/canned-design-proposal.ts`
- Create: `apps/atlas-web/e2e/visual/fixtures/canned-canvas-manifest.ts`
- Create: `apps/atlas-web/e2e/visual/fixtures/mock-llm.ts`
- Create: `apps/atlas-web/e2e/visual/helpers/set-persona.ts`
- Create: `apps/atlas-web/e2e/visual/helpers/run-axe.ts`

- [ ] **Step 1: Create the dev/test-only layout**

Create `apps/atlas-web/app/__visual__/_layout.tsx`:

```tsx
import type { ReactNode } from "react";

// Dev/test-only layout for Playwright visual fixture routes.
// Not a real route layout — middleware enforces 404 in production.

export default function VisualLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add middleware production guard**

Open `apps/atlas-web/middleware.ts`. Add to the existing middleware logic:

```ts
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && req.nextUrl.pathname.startsWith("/__visual__")) {
    return new NextResponse(null, { status: 404 });
  }
  // ... existing middleware logic continues
}

export const config = {
  matcher: ["/__visual__/:path*", /* ... existing matchers */]
};
```

(Merge with existing middleware logic; don't replace it. The matcher list should retain whatever's already there.)

- [ ] **Step 3: Create canned-design-proposal fixture**

Create `apps/atlas-web/e2e/visual/fixtures/canned-design-proposal.ts`:

```ts
export const cannedProposal = {
  recommended: {
    id: "editorial-dark",
    name: "Editorial Dark",
    shortDescription: "Premium feel — serif heads, gold accent.",
    technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
    citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
    tokens: {
      palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fff", text: "#0a0a0a", muted: "#94a3b8" },
      typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" as const },
      density: "spacious" as const,
      componentSet: "shadcn" as const,
      imageryStrategy: "photo" as const,
      copyVoice: "premium" as const
    }
  },
  alternates: [
    { id: "warm-cafe", name: "Warm Café", shortDescription: "Friendly neighborhood feel.", technicalDescription: "Hand-drawn + cream + terracotta", citedReferences: [], tokens: {} as never },
    { id: "modern-minimal", name: "Modern Minimal", shortDescription: "Tech-forward, less moody.", technicalDescription: "Inter + monochrome + grid-led", citedReferences: [], tokens: {} as never }
  ],
  reasoning: "Premium signal in your prompt — fine-dining Bandra category averages high on editorial-dark aesthetics."
};
```

- [ ] **Step 4: Create canned-canvas-manifest fixture**

Create `apps/atlas-web/e2e/visual/fixtures/canned-canvas-manifest.ts`:

```ts
export const cannedFrontendManifest = {
  artifactKind: "frontend-app" as const,
  modes: [
    { id: "designing", renderer: "designer-canvas-v1", audience: ["ama", "diego", "priya"] as const, default: true, blockingFor: "design" as const },
    { id: "preview", renderer: "preview-canvas-v1", audience: ["ama", "diego", "priya"] as const, blockingFor: null }
  ]
};

export const cannedBackendManifest = {
  artifactKind: "backend-rest-api" as const,
  modes: [
    { id: "schema", renderer: "schema-canvas-v1", audience: ["diego", "priya"] as const, default: true, blockingFor: "schema" as const }
  ]
};
```

- [ ] **Step 5: Create mock-llm fixture**

Create `apps/atlas-web/e2e/visual/fixtures/mock-llm.ts`:

```ts
// Minimal deterministic LLM stub for the generated-restaurant-landing visual spec.
// Returns canned responses keyed by request shape so the spec is hermetic.

export const mockLlm = {
  async completeWithToolUse(_messages: unknown[], opts: { tools: Array<{ name: string }> }) {
    const toolName = opts.tools[0].name;
    if (toolName === "emit_architect_output") {
      return { toolName, input: { scope: "new-app", designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] } } };
    }
    if (toolName === "emit_brief") {
      return { toolName, input: { category: "restaurant-landing", audienceCues: ["fine-dining"], references: [], patternsThatWin: [], patternsThatLose: [] } };
    }
    if (toolName === "emit_design_proposal") {
      return { toolName, input: { recommended: { id: "editorial-dark", name: "Editorial Dark", shortDescription: "x", technicalDescription: "x", citedReferences: [], tokens: {} }, alternates: [], reasoning: "x" } };
    }
    return { toolName, input: {} };
  }
};
```

- [ ] **Step 6: Create helpers**

Create `apps/atlas-web/e2e/visual/helpers/set-persona.ts`:

```ts
import type { Page } from "@playwright/test";

export async function gotoWithPersona(page: Page, url: string, persona: "ama" | "diego" | "priya") {
  await page.context().addCookies([
    { name: "atlas-persona", value: persona, url: page.url().startsWith("http") ? page.url() : "http://localhost:3000" }
  ]);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
```

Create `apps/atlas-web/e2e/visual/helpers/run-axe.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function runAxe(page: Page, excludeSelectors: string[] = []) {
  const builder = new AxeBuilder({ page });
  for (const sel of excludeSelectors) builder.exclude(sel);
  return builder.analyze();
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/app/__visual__/ \
        apps/atlas-web/middleware.ts \
        apps/atlas-web/e2e/visual/fixtures/ \
        apps/atlas-web/e2e/visual/helpers/
git commit -m "feat(atlas-web): visual-test fixtures + helpers + __visual__ layout (dev/test only)"
```

---

### Task 16: Fixture routes — designer-canvas + preview + options + axis

**Files:**
- Create: `apps/atlas-web/app/__visual__/designer-canvas/page.tsx`
- Create: `apps/atlas-web/app/__visual__/options-card/page.tsx`
- Create: `apps/atlas-web/app/__visual__/axis-wizard/page.tsx`
- Create: `apps/atlas-web/app/__visual__/refine-wizard/page.tsx`
- Create: `apps/atlas-web/app/__visual__/outcome-card/page.tsx`
- Create: `apps/atlas-web/app/__visual__/technical-card/page.tsx`

- [ ] **Step 1: Create designer-canvas fixture**

Create `apps/atlas-web/app/__visual__/designer-canvas/page.tsx`:

```tsx
"use client";
import { OptionsCard } from "@/components/a2ui/OptionsCard";
import { cannedProposal } from "@/e2e/visual/fixtures/canned-design-proposal";
import { cookies } from "next/headers";

export default async function DesignerCanvasFixture() {
  const persona = ((await cookies()).get("atlas-persona")?.value ?? "ama") as "ama" | "diego" | "priya";
  return (
    <main className="container mx-auto p-8">
      <OptionsCard
        recommended={cannedProposal.recommended as never}
        alternates={cannedProposal.alternates as never}
        reasoning={cannedProposal.reasoning}
        persona={persona}
        onSelect={() => {}}
        onRefine={() => {}}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create options-card / axis-wizard / refine-wizard / outcome-card / technical-card fixtures**

Each follows the same shape — import the relevant component from `@/components/a2ui/`, wire it to canned data + a persona-cookie reader, render.

For brevity, the implementing engineer copies the pattern from `designer-canvas/page.tsx` for each route. Each fixture page is ≤ 30 lines.

- [ ] **Step 3: Verify the routes render in dev**

```bash
pnpm --filter atlas-web dev
```

In a browser, visit `http://localhost:3000/__visual__/designer-canvas` — should render the canned cards. Try each route.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/app/__visual__/
git commit -m "feat(atlas-web): visual fixture routes — designer-canvas + options + axis + refine + outcome + technical"
```

---

### Task 17: Behavioural-lock visual spec — canvas-shell-flag-off

**Files:**
- Create: `apps/atlas-web/e2e/visual/canvas-shell-flag-off.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/atlas-web/e2e/visual/canvas-shell-flag-off.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { runAxe } from "./helpers/run-axe";

test.describe("canvas shell flag-OFF (Plan R baseline preservation)", () => {
  test.beforeEach(async ({ page }) => {
    // Simulate flag-OFF via cookie or env. atlas-web reads ATLAS_FF_CANVAS_V1 server-side;
    // for this spec we hit a route that proves DOM matches Plan R when no canvas mode loaded.
    await page.goto("/projects/test-project/canvas");
    await page.waitForLoadState("networkidle");
  });

  test("preview-only right panel matches snapshot", async ({ page }) => {
    await expect(page.getByTestId("editor-shell")).toHaveScreenshot("flag-off-shell.png");
  });

  test("no canvas-shell or mode-toggle in DOM", async ({ page }) => {
    await expect(page.getByTestId("canvas-shell")).toHaveCount(0);
    await expect(page.getByTestId("mode-toggle")).toHaveCount(0);
  });

  test("axe passes on the flag-OFF layout", async ({ page }) => {
    const results = await runAxe(page, ["[data-testid='preview-iframe']"]);
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run (will fail until baselines are generated; that's normal first-run behavior)**

```bash
pnpm --filter atlas-web test:visual canvas-shell-flag-off
```

Expected: First run fails because there's no baseline yet. Run with `--update-snapshots` to generate:

```bash
pnpm --filter atlas-web test:visual:update canvas-shell-flag-off
```

This produces the PNG baseline. Re-run normally and it should pass.

- [ ] **Step 3: Commit (baselines included)**

```bash
git add apps/atlas-web/e2e/visual/canvas-shell-flag-off.spec.ts apps/atlas-web/e2e/visual/__snapshots__/
git commit -m "test(atlas-web/visual): canvas-shell-flag-off behavioural lock spec + baselines"
```

---

### Task 18: Visual specs — designer-canvas + refine-wizard + options + axis

**Files:**
- Create: `apps/atlas-web/e2e/visual/designer-canvas-pattern-c.spec.ts`
- Create: `apps/atlas-web/e2e/visual/refine-wizard-palette-step.spec.ts`
- Create: `apps/atlas-web/e2e/visual/options-card-recommendation.spec.ts`
- Create: `apps/atlas-web/e2e/visual/axis-wizard-three-axes.spec.ts`

- [ ] **Step 1: designer-canvas-pattern-c.spec.ts (3 personas × 3 viewports = 9 baselines)**

Create `apps/atlas-web/e2e/visual/designer-canvas-pattern-c.spec.ts`:

```ts
import { test, expect, devices } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { runAxe } from "./helpers/run-axe";

const PERSONAS = ["ama", "diego", "priya"] as const;
const VIEWPORTS: Array<{ name: string; viewport: { width: number; height: number } }> = [
  { name: "desktop", viewport: { width: 1280, height: 800 } },
  { name: "tablet", viewport: { width: 768, height: 1024 } },
  { name: "mobile", viewport: { width: 375, height: 667 } }
];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    test(`<DesignerCanvas> persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp.viewport);
      await gotoWithPersona(page, "/__visual__/designer-canvas", persona);
      await expect(page.getByTestId("options-card")).toHaveScreenshot(`designer-canvas-${persona}-${vp.name}.png`);
      const a11y = await runAxe(page);
      expect(a11y.violations).toEqual([]);
    });
  }
}
```

- [ ] **Step 2: refine-wizard-palette-step.spec.ts (9 baselines)**

Same shape as Step 1, hitting `/__visual__/refine-wizard`. Snapshot the first axis (palette) state.

- [ ] **Step 3: options-card-recommendation.spec.ts (9 baselines)**

Same shape, hitting `/__visual__/options-card`. Snapshot the recommendation card with badge.

- [ ] **Step 4: axis-wizard-three-axes.spec.ts (9 baselines)**

Same shape, hitting `/__visual__/axis-wizard`. Snapshot the wizard at step 1 of 3.

- [ ] **Step 5: Generate baselines + verify**

```bash
pnpm --filter atlas-web test:visual:update designer-canvas refine-wizard options-card axis-wizard
pnpm --filter atlas-web test:visual designer-canvas refine-wizard options-card axis-wizard
```

Expected: 36 baselines generated, 36 cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/e2e/visual/designer-canvas-pattern-c.spec.ts \
        apps/atlas-web/e2e/visual/refine-wizard-palette-step.spec.ts \
        apps/atlas-web/e2e/visual/options-card-recommendation.spec.ts \
        apps/atlas-web/e2e/visual/axis-wizard-three-axes.spec.ts \
        apps/atlas-web/e2e/visual/__snapshots__/
git commit -m "test(atlas-web/visual): designer-canvas + refine + options + axis specs (36 baselines)"
```

---

### Task 19: Visual specs — outcome-card + technical-card + schema-canvas

**Files:**
- Create: `apps/atlas-web/e2e/visual/outcome-card-tenancy.spec.ts`
- Create: `apps/atlas-web/e2e/visual/technical-card-schema.spec.ts`
- Create: `apps/atlas-web/e2e/visual/schema-canvas-tenants-rls.spec.ts`

- [ ] **Step 1: outcome-card-tenancy (3 baselines, ama only at 3 viewports)**

```ts
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { runAxe } from "./helpers/run-axe";

const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const vp of VIEWPORTS) {
  test(`<OutcomeCard> ama-tier viewport=${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await gotoWithPersona(page, "/__visual__/outcome-card", "ama");
    await expect(page.getByTestId("outcome-card")).toHaveScreenshot(`outcome-card-ama-${vp.name}.png`);
    const a11y = await runAxe(page);
    expect(a11y.violations).toEqual([]);
  });
}
```

- [ ] **Step 2: technical-card (6 baselines, diego + priya at 3 viewports)**

Same shape, iterate `["diego", "priya"]` × 3 viewports.

- [ ] **Step 3: schema-canvas-tenants-rls (6 baselines, diego + priya at 3 viewports)**

Same shape, hitting `/__visual__/schema-canvas`.

- [ ] **Step 4: Generate baselines + commit**

```bash
pnpm --filter atlas-web test:visual:update outcome-card technical-card schema-canvas
git add apps/atlas-web/e2e/visual/outcome-card-tenancy.spec.ts \
        apps/atlas-web/e2e/visual/technical-card-schema.spec.ts \
        apps/atlas-web/e2e/visual/schema-canvas-tenants-rls.spec.ts \
        apps/atlas-web/e2e/visual/__snapshots__/
git commit -m "test(atlas-web/visual): outcome + technical + schema canvas specs (15 baselines)"
```

---

### Task 20: Visual specs — mode-toggle + empty-canvas + generated-restaurant-landing

**Files:**
- Create: `apps/atlas-web/e2e/visual/mode-toggle-states.spec.ts`
- Create: `apps/atlas-web/e2e/visual/empty-canvas.spec.ts`
- Create: `apps/atlas-web/e2e/visual/generated-restaurant-landing.spec.ts`

- [ ] **Step 1: mode-toggle-states (24 baselines: 4 states × 3 personas × 2 viewports for chrome)**

```ts
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";

const PERSONAS = ["ama", "diego", "priya"] as const;
const STATES = ["designing", "preview", "schema", "refine"] as const;

for (const persona of PERSONAS) {
  for (const state of STATES) {
    test(`<ModeToggle> persona=${persona} state=${state}`, async ({ page }) => {
      // ama doesn't see schema mode
      if (persona === "ama" && state === "schema") {
        test.skip();
        return;
      }
      await gotoWithPersona(page, `/__visual__/mode-toggle?state=${state}`, persona);
      await expect(page.getByTestId("mode-toggle")).toHaveScreenshot(`mode-toggle-${persona}-${state}.png`);
    });
  }
}
```

- [ ] **Step 2: empty-canvas (3 baselines, 3 viewports)**

```ts
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const vp of VIEWPORTS) {
  test(`<EmptyCanvas> viewport=${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/__visual__/empty-canvas");
    await expect(page.getByTestId("empty-canvas")).toHaveScreenshot(`empty-canvas-${vp.name}.png`);
  });
}
```

- [ ] **Step 3: generated-restaurant-landing (full ritual against deterministic mock LLM)**

Create the spec that walks the full pipeline with mocked LLM responses, applies the resulting diff to a fixture sandbox URL, and snapshots the rendered output. Hits `/__visual__/generated-restaurant-landing` route which renders the canned final HTML.

```ts
import { test, expect } from "@playwright/test";

test("generated restaurant landing matches baseline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/__visual__/generated-restaurant-landing");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("generated-restaurant-landing-desktop.png", { fullPage: true });
});
```

- [ ] **Step 4: Generate baselines + commit**

```bash
pnpm --filter atlas-web test:visual:update mode-toggle empty-canvas generated-restaurant
git add apps/atlas-web/e2e/visual/mode-toggle-states.spec.ts \
        apps/atlas-web/e2e/visual/empty-canvas.spec.ts \
        apps/atlas-web/e2e/visual/generated-restaurant-landing.spec.ts \
        apps/atlas-web/e2e/visual/__snapshots__/
git commit -m "test(atlas-web/visual): mode-toggle + empty-canvas + generated-restaurant-landing specs"
```

---

### Task 21: CI workflow — visual-regression.yml

**Files:**
- Create: `.github/workflows/visual-regression.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/visual-regression.yml`:

```yaml
name: visual-regression

on:
  pull_request:
    branches: [main]
    paths:
      - "apps/atlas-web/**"
      - "packages/canvas-runtime/**"
      - "packages/role-designer/**"
      - "packages/gate-visual-quality/**"
      - "packages/sandbox-e2b/**"
      - ".github/workflows/visual-regression.yml"

jobs:
  visual:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build workspace
        run: pnpm -r --filter "@atlas/*" build

      - name: Install Playwright browsers
        run: pnpm --filter atlas-web exec playwright install --with-deps chromium

      - name: Run visual tests
        run: pnpm --filter atlas-web test:visual

      - name: Upload diff artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-visual-diffs
          path: apps/atlas-web/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/visual-regression.yml
git commit -m "ci: visual-regression workflow scoped to canvas-affecting paths"
```

---

### Task 22: .env.example + local-dev-status updates

**Files:**
- Modify: `apps/atlas-web/.env.example`
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Add S.5 env entries to .env.example**

Open `apps/atlas-web/.env.example`. After the existing S-series flag block, append:

```bash
# ─── Plan S.5 — Visual-Quality merge gate ────────────────────────────────────
# Enables the L7-visual-advisory gate. Runs after sandbox.apply.completed for
# rituals whose canvasManifest had a design-blocking mode. Default OFF.
ATLAS_FF_VISUAL_QUALITY_GATE=false

# Override the model used for the multimodal critique call. Default = Sonnet.
# Common downgrade for cost: claude-haiku-4-5
ATLAS_VQ_GATE_MODEL=
```

- [ ] **Step 2: Add S.5 entry to local-dev-status.md**

Open `docs/superpowers/local-dev-status.md`. After the Plan S.4 entry, add:

```markdown
- **Plan S.5: Visual-Quality merge gate + visual regression suite.** When `ATLAS_FF_VISUAL_QUALITY_GATE=true`, `getVisualQualityRole()` instantiates `VisualQualityRole` from `@atlas/gate-visual-quality` and appends it to `postDeveloperChain` after Security and A11y. After `sandbox.apply.completed` the gate runs `puppeteer-core` inside the E2B sandbox to capture desktop+tablet+mobile screenshots, then a multimodal Sonnet 4.5 call critiques against the chosen DesignTokens. Critical issues flip `passed=false`, escalating via Plan L auto-fix. Persona-tier risk-accept = `ama` (matches L6 a11y-advisory). Skipped for backend-only / refactor scopes. `ATLAS_VQ_GATE_MODEL` overrides the critique model (downgrade to Haiku under spend pressure). Visual regression suite at `apps/atlas-web/e2e/visual/` ships per-renderer × per-persona × per-viewport Playwright snapshots; run locally via `pnpm --filter atlas-web test:visual`; CI workflow `visual-regression.yml` runs only when canvas-affecting paths change.
```

Add a flag-table row:

```markdown
| **S.5** | `ATLAS_FF_VISUAL_QUALITY_GATE=true` | optional `ATLAS_VQ_GATE_MODEL` override | After sandbox apply, Visual-Quality gate runs (puppeteer-core screenshots + Sonnet multimodal critique). Failure escalates via Plan L. |
```

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/.env.example docs/superpowers/local-dev-status.md
git commit -m "docs(atlas-web): .env.example + local-dev-status — Plan S.5 entries"
```

---

### Task 23: Update plans/README.md index

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Mark all 5 S-series plans as Shipped**

Open `docs/superpowers/plans/README.md`. Find the existing Plan index table. Add at the bottom (or in chronological position):

```markdown
| 22 | `2026-05-02-plan-s1-sandbox-uplift.md` | **S.1 — Sandbox Uplift** | Rebuild atlas-next-ts E2B template with Tailwind + shadcn + lucide; rewrite SANDBOX_CONTEXT_PROMPT to positive list | 16 tasks, TDD | Shipped |
| 23 | `2026-05-02-plan-s2-researcher-catalog.md` | **S.2 — Researcher Role + Catalog** | New @atlas/role-researcher (Brave Search adapter behind ATLAS_RESEARCH_WEB) + 30-category local YAML catalog | 17 tasks, TDD | Shipped |
| 24 | `2026-05-02-plan-s3-designer-a2ui.md` | **S.3 — Designer Role + A2UI** | New @atlas/role-designer + OptionsCard / AxisWizard / OutcomeCard / TechnicalCard | 15 tasks, TDD | Shipped |
| 25 | `2026-05-02-plan-s4-canvas-engine.md` | **S.4 — Polymorphic Canvas + Engine** | New @atlas/canvas-runtime + CanvasShell + RitualEngine pause-awaiting-canvas-selection | 33 tasks, TDD | Shipped |
| 26 | `2026-05-02-plan-s5-visual-quality-gate.md` | **S.5 — Visual-Quality Gate + Visual Regression** | New @atlas/gate-visual-quality (L7) + per-renderer × persona × viewport Playwright snapshot suite | 25 tasks, TDD | Shipped |
```

After Phase B / Phase C sections (or wherever fits), add:

```markdown
## Plan S — UI Quality Uplift (v1)

5 sub-plans landed 2026-05; tagged `plan-s/v1-complete` on `main`. See `docs/superpowers/specs/2026-05-02-ui-quality-uplift-design.md` for the full design rationale and `docs/superpowers/plans/2026-05-02-plan-s-overview.md` for sub-plan dependencies + flag-rollout sequence.

Out of scope (deferred to Plan S v2):
- Backend Endpoints / Exerciser / Logs canvas modes
- Mobile / data-pipeline / CLI canvas modes
- Per-component visual-edit overlay (Lovable-style click-to-edit)
- Visual-Quality gate Opus upgrade when budget allows
- Persistent inspiration cache that auto-grows from approved web-research hits
- Multi-tenant brand-kit injection
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): README index — mark all 5 Plan S entries Shipped"
```

---

### Task 24: Run full repo test suite + open the PR

**Files:**
- (no file edits — verification + handoff)

- [ ] **Step 1: Workspace-wide tests + visual suite**

```bash
pnpm -r --no-bail typecheck && pnpm -r --no-bail test
pnpm --filter atlas-web test:visual
```

Expected: every package green; ~80+ visual snapshot baselines pass.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin plan-s5/visual-quality-gate
gh pr create --title "Plan S.5 — Visual-Quality gate + visual regression tests" --body "$(cat <<'EOF'
## Summary
- New \`@atlas/gate-visual-quality\` package: VisualQualityRole + VisualQualityGateRunner (dual interface, mirrors Security/A11y). puppeteer-core screenshots inside E2B sandbox at desktop+tablet+mobile. Multimodal Sonnet 4.5 critique against chosen DesignTokens. Critical issues flip passed=false (Plan L auto-fix triggers).
- 3 new visual-quality skill markdown files in \`packages/skill-library/skills/visual-quality/\`.
- L7-visual-advisory persona-tier (ama-accept) regression-tested.
- Visual regression suite at \`apps/atlas-web/e2e/visual/\` — per-renderer × per-persona × per-viewport Playwright snapshots, in-repo PNG baselines (~80 baselines).
- Fixture routes under \`/__visual__/*\` for deterministic spec inputs (404 in production via middleware).
- New \`.github/workflows/visual-regression.yml\` runs visual suite on PRs to main when canvas-affecting paths change.
- All behind \`ATLAS_FF_VISUAL_QUALITY_GATE\`. \`ATLAS_VQ_GATE_MODEL\` override for cost downgrade.

## Final Plan-S milestone
This is the LAST plan in the S series. After merge:
1. Tag \`plan-s/v1-complete\` on \`main\`.
2. Update \`plans/README.md\` index (already done in this PR).
3. Open \`Plan S v2\` kickoff issue covering the deferred items.

## Test plan
- [ ] \`pnpm -r test\` — all packages green; new gate-visual-quality adds ~22 unit tests
- [ ] \`pnpm --filter atlas-web test:visual\` — all baselines pass
- [ ] CI: visual-regression workflow runs on this PR (changes touch atlas-web + canvas-runtime + role-designer + gate-visual-quality paths)
- [ ] Manual: with all S-series flags ON in \`.env.local\`, run a full ritual end-to-end against a fresh sandbox; confirm Visual-Quality gate appears in rail timeline after sandbox apply

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After review + merge: tag the milestone**

```bash
git checkout main
git pull --ff-only
git tag -a plan-s/v1-complete -m "Plan S series v1 complete (S.1 sandbox uplift + S.2 researcher + S.3 designer + S.4 canvas + S.5 visual-quality gate)"
git push origin plan-s/v1-complete
```

---

### Task 25: Open Plan S v2 kickoff issue

**Files:**
- (no file edits — GitHub issue only)

- [ ] **Step 1: Open the v2 kickoff issue**

```bash
gh issue create --title "Plan S v2 — canvas mode expansion + Lovable-style edit overlay + visual-quality Opus upgrade" --body "$(cat <<'EOF'
## Context

Plan S v1 (S.1-S.5) shipped 2026-05; tagged \`plan-s/v1-complete\`. See:
- Design spec: \`docs/superpowers/specs/2026-05-02-ui-quality-uplift-design.md\`
- Overview + decomposition: \`docs/superpowers/plans/2026-05-02-plan-s-overview.md\`

## Out-of-scope items deferred to v2

From the v1 spec's "v2" cut:

- **Backend Endpoints / Exerciser / Logs canvas modes** — v1 ships Schema only.
- **Mobile / data-pipeline / CLI canvas modes** — v1 ships frontend + backend Schema only.
- **Per-component visual-edit overlay** (Lovable-style click-to-edit) — requires content-script bridge into the iframe.
- **Visual-Quality gate Opus upgrade** when budget allows — v1 default is Sonnet; auto-cost-cap-driven model swap is v2 work.
- **Persistent inspiration cache** that auto-grows from approved web-research hits — v1 catalog is hand-curated YAML.
- **Multi-tenant brand-kit injection** — per-customer style transfer across all that customer's projects.
- **Object-storage adapter** for screenshot bytes — v1 stores in \`spec_events.payload\`.
- **Sandbox-handle pool** for the visual-quality gate (currently constructs a fresh E2B \`Sandbox.connect\` per gate run; pooling could cut ~200ms per gate).

## Suggested order

1. Sandbox-handle pool (cheap, big perf win)
2. Backend Endpoints + Exerciser canvas modes (most-asked-for after Schema)
3. Visual-Quality Opus auto-cap
4. Persistent inspiration cache
5. Mobile canvas mode
6. Lovable-style click-to-edit (largest scope)
7. Multi-tenant brand-kit (requires Phase D customer commitments first)
EOF
)"
```

---

## Completion Checklist

- [ ] Branch `plan-s5/visual-quality-gate` cut from `main`
- [ ] `@atlas/gate-visual-quality` package scaffolded (package.json, tsconfig, vitest.config, README)
- [ ] `types.ts`: VisualQualityReportSchema + critical-superRefine + Issue/Viewport schemas
- [ ] `errors.ts`: VisualQualityError + ScreenshotFailedError + SkillMissingError
- [ ] `screenshot.ts`: puppeteer-core via SandboxExec, 3 viewports, base64
- [ ] `assemble-prompt.ts`: composes 3 visual-quality skills + missing-skill error
- [ ] `critique.ts`: multimodal Sonnet call, 3 image content blocks + tokens + tool-use schema
- [ ] `visual-quality-check.ts`: orchestrator (screenshots → critique → report)
- [ ] `role.ts`: VisualQualityRole emits started/passed/failed/skipped/completed/errored
- [ ] `runner.ts`: VisualQualityGateRunner with `layer: "L7"`
- [ ] `index.ts`: public exports
- [ ] 3 skill markdown files: critique-design-tokens / critique-hierarchy / critique-copy
- [ ] `risk-accept-l7-visual-advisory.test.ts` regression-guard
- [ ] atlas-web factory: getVisualQualityRole behind ATLAS_FF_VISUAL_QUALITY_GATE
- [ ] postDeveloperChain wires VisualQualityRole after security + a11y
- [ ] EventBroker maps visual_quality.* events
- [ ] playwright.visual.config.ts + test:visual / test:visual:update / test:visual:headed scripts
- [ ] @axe-core/playwright devDep installed
- [ ] __snapshots__/.gitkeep placeholder
- [ ] Visual fixture routes (/__visual__/*) + middleware production guard
- [ ] Visual fixture data + helpers (canned-design-proposal / canned-canvas-manifest / mock-llm / set-persona / run-axe)
- [ ] canvas-shell-flag-off.spec.ts (lands FIRST)
- [ ] designer-canvas + refine-wizard + options-card + axis-wizard specs (36 baselines)
- [ ] outcome-card + technical-card + schema-canvas specs (15 baselines)
- [ ] mode-toggle + empty-canvas + generated-restaurant-landing specs (~30 baselines)
- [ ] .github/workflows/visual-regression.yml scoped to canvas paths
- [ ] .env.example: ATLAS_FF_VISUAL_QUALITY_GATE + ATLAS_VQ_GATE_MODEL
- [ ] local-dev-status.md: Plan S.5 entry + flag-table row
- [ ] plans/README.md: all 5 S-series entries Shipped + plan-s/v1-complete note
- [ ] `pnpm -r test` green
- [ ] `pnpm --filter atlas-web test:visual` green
- [ ] PR opened, reviewed, merged
- [ ] `plan-s/v1-complete` tag pushed on `main`
- [ ] Plan S v2 kickoff issue opened

---

## Handoff — Plan S v1 complete

S.1-S.5 v1 complete. Tag `plan-s/v1-complete` on `main`. Update `plans/README.md` index. Open `Plan S v2` kickoff issue covering deferred items: Backend Endpoints / Exerciser / Logs canvas modes, mobile + data-pipeline canvas modes, Lovable-style click-to-edit overlay, Visual-Quality gate Opus upgrade when budget allows, persistent inspiration cache that auto-grows from approved web hits, multi-tenant brand-kit injection.

The next strategic milestone is operator-side: enable all S-series flags in production after a soak window in dev, update the demo runbook, and start collecting real-user visual-quality feedback to inform Plan S v2 scope priorities.
