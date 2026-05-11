# UI Quality Uplift via Researcher + Designer + Polymorphic Canvas — Design

**Date:** 2026-05-02
**Status:** Awaiting user review
**Plans this spec produces:** one (working title: Plan S — UI Quality Uplift, v1)

---

## Problem

The website Atlas generates today is **functionally correct and aesthetically nothing**. Concrete evidence: a "Mumbai Spice Kitchen" landing page produced for the prompt *"build me a restaurant landing page"* renders as a flat orange header bar over a beige hero, system-ui font, no real photography, no design system, generic LLM-prose copy ("Where Families Come Together Over Authentic Flavors"). This output would have read as middling in 2002 and is unshippable in 2026.

Three root causes, all in code we own:

1. **The Architect is design-blind.** It composes only `brainstorm`, `spec-graph`, and `runnable-plan` skills (`packages/role-architect/src/deep-plan.ts:148`). None mention layout, typography, brand voice, design tokens, content design, or competitive references. The architect classifies scope and writes a plan; it never thinks about what *good* looks like in the user's category.

2. **The Developer is design-system-forbidden.** `SANDBOX_CONTEXT_PROMPT` (`packages/role-developer/src/assemble-prompt.ts:20-54`) explicitly enumerates *what is unavailable* — no Tailwind, no lucide-react, no framer-motion, no clsx/shadcn/radix. The fallback is "inline `style={{ }}` objects, plain `<style jsx>` tags, or CSS in `globals.css`." This was the right short-term fix after commit `2ee7fe7` discovered the deployed E2B template's `package.json` doesn't ship those deps — but the cure now blocks any modern aesthetic.

3. **There is no visibility into design quality.** Security and Accessibility merge gates (Plan I) exist; a Visual-Quality gate does not. Nothing screenshots the rendered preview, nothing critiques against intent, nothing escalates a 2002-looking page back into the auto-fix loop (Plan L).

The user's bar is **Tier B as floor, Tier C ceiling** — modern design-system polish at minimum, editorial / award-tier (linear.app, vercel.com) for marketing surfaces. The user also signaled a deeper rearchitecture: **the preview zone is empty for the first 30–60s of every ritual** while architect/researcher/designer run, and that real estate should host an interactive **design canvas** — full-size option cards the user can browse and pick from. This same canvas should adapt to backend projects (schema-direction picker for diego/priya, outcome-framed cards for ama).

## Goals

1. **Match Tier B as the unconditional floor** — modern type scale, real design tokens, vetted color palettes, never ship inline-style React.
2. **Reach Tier C for any prompt that warrants it** — editorial / award-tier output for marketing, content, and "look at me" surfaces. Architect classifies design intensity.
3. **Make design a conversation, not a one-shot.** The architect/designer presents 1 recommended direction + 2 alternates with reasoning. User accepts, refines axis-by-axis, or describes their own.
4. **Use the otherwise-empty preview zone as the design canvas** during pre-sandbox phases. Same shell as today, new modes wired in.
5. **Polymorphic canvas** — same primitive renders frontend Design + Preview, backend Schema (and v2 Endpoints + Exerciser + Logs), mobile (v2), data pipeline (v2). Adding a mode is shipping a new renderer, not changing the shell.
6. **Persona-aware framing** — ama (non-technical) sees outcome cards; diego (developer) sees Schema canvas with SQL/RLS; priya (senior) gets all instrumentation modes. Same architect/designer artifact under the hood.
7. **Close the design feedback loop** — a Visual-Quality merge gate screenshots the sandbox after diff-apply and critiques against the chosen design tokens. Failures escalate via the existing Plan L auto-fix loop.
8. **Test everything, including visually.** Playwright snapshot tests per renderer × per persona, runnable locally and in CI.

## Non-Goals (v1)

- Live web search for design references *if* it adds significant token cost — local catalog is the fallback. (Decision deferred to implementation; see Open Questions.)
- Mobile / data-pipeline / CLI canvas modes — v2.
- Endpoints / Exerciser / Logs canvas modes for backend — v2.
- Per-component visual editing inside the preview iframe (Lovable-style click-to-edit) — separate plan.
- Multi-tenant skin-the-output customization (per-customer brand kit injection) — separate plan.
- Replacing the existing Architect role; the new roles slot upstream/downstream of it.

---

## Architecture

### End-to-end flow

```
ChatPanel.send (browser)
  → startRitual (Server Action)
    → RitualEngine.start
      → Conductor.dispatch (architect)
        → ArchitectRole.run
          → triage (Pass 1) — classifies scope + emits designIntent
          → deepPlan (Pass 2) — emits artifact + canvasManifest
      → if ritualMode !== "fast" AND canvasManifest includes design-bearing modes:
        # ritualMode is a per-ritual setting on RitualOptions
        # default "considered"; user toggles via a "Fast mode" switch in ChatPanel
        → Conductor.dispatch (researcher)
          → ResearcherRole.run — local catalog hit + optional web fetch → InspirationBrief
      → Conductor.dispatch (designer)
        → DesignerRole.run — emits DesignProposal { recommended, alternates[] }
      → emits canvas.options.requested { proposal, manifest }
        ChatPanel reacts: switches preview zone to "Designing" mode
        Renders DesignerCanvas (Pattern C — recommendation + alternates)
        User clicks "Use this →" or "Refine"
        Refine opens Pattern B wizard (palette → typography → density)
      → engine receives canvas.option.selected { selectedTokens }
      → Conductor.dispatch (developer, priorArtifact = artifact + selectedTokens)
        → DeveloperRole.run — diff against Tailwind+shadcn+lucide-enabled sandbox
      → applyDiff → sandbox HMR → preview iframe auto-reload (Plan F)
      → engine auto-switches preview zone back to "Preview" mode
      → postDeveloperChain: Security gate → A11y gate → Visual-Quality gate (NEW)
      → on any gate failure → Plan L auto-fix loop kicks in
```

### Component additions

```
packages/
  role-researcher/                    # NEW — D.6
    src/role.ts                       # ResearcherRole implements Role from @atlas/conductor
    src/local-catalog.ts              # loads packages/skill-library/skills/designer/catalog/*.yaml
    src/web-fetch.ts                  # optional: Brave Search adapter behind ATLAS_RESEARCH_WEB=1
    src/types.ts                      # InspirationBriefSchema (Zod)

  role-designer/                      # NEW — D.7
    src/role.ts                       # DesignerRole implements Role
    src/proposal.ts                   # turns InspirationBrief → DesignProposal (1 + 2 alternates)
    src/refine.ts                     # axis-by-axis refinement (palette/type/density)
    src/types.ts                      # DesignProposalSchema, DesignTokensSchema

  canvas-runtime/                     # NEW
    src/types.ts                      # CanvasManifestSchema, CanvasMode union
    src/registry.ts                   # CanvasModeRegistry — registers renderers by id
    src/persona-filter.ts             # filters manifest.modes by persona audience
    src/events.ts                     # extends RitualEventType with canvas.* events

  gate-visual-quality/                # NEW — L7-visual-advisory
    src/runner.ts                     # GateRunner implementation; uses Playwright + LLM critique
    src/screenshot.ts                 # E2B-side screenshot (puppeteer-core) → byte buffer
    src/critique.ts                   # LLM call returning VisualQualityReport
    src/types.ts                      # VisualQualityReportSchema

  skill-library/skills/
    designer/                         # NEW skill family
      catalog/                        # 30-50 category YAMLs (restaurant-landing, saas-marketing, ...)
      design-tokens.md
      reference-pattern.md
      refine-axis.md
    researcher/
      assemble-brief.md
      cite-references.md
    visual-quality/
      critique-design-tokens.md
      critique-hierarchy.md
      critique-copy.md

  sandbox-e2b/templates/
    atlas-next-ts/                    # MODIFIED — Tailwind + shadcn + lucide truly installed
                                      # (rebuild + republish E2B image — see Sandbox uplift below)

apps/atlas-web/
  components/
    canvas/
      CanvasShell.tsx                 # NEW — bimodal/polymorphic shell, replaces current preview-only
      ModeToggle.tsx                  # NEW — top-right Designing / Preview / Schema / ... toggle
      EmptyCanvas.tsx                 # NEW — when no canvas mode is active
      renderers/
        DesignerCanvas.tsx            # NEW — Pattern C cards
        RefineWizard.tsx              # NEW — Pattern B (palette → type → density)
        PreviewCanvas.tsx             # MOVED — wraps existing CanvasPreviewClient
        SchemaCanvas.tsx              # NEW — backend Schema picker, persona-aware
    a2ui/
      OptionsCard.tsx                 # NEW — generic A2UI primitive (recommendation + alternates)
      AxisWizard.tsx                  # NEW — generic axis-by-axis refine
      OutcomeCard.tsx                 # NEW — ama-tier card framing (no jargon)
      TechnicalCard.tsx               # NEW — diego/priya-tier framing (code/SQL/diagrams)
  app/projects/[projectId]/
    canvas/page.tsx                   # MODIFIED — wraps in <CanvasShell>, drops standalone preview
  lib/
    canvas/
      use-canvas-state.ts             # client-side mode-state hook (auto-switch + override)
      use-design-selection.ts         # observes canvas.option.selected events for current ritual

packages/ritual-engine/
  src/engine.ts                       # MODIFIED — adds Researcher/Designer dispatch + canvas-event emission
  src/canvas-pause.ts                 # NEW — engine pauses awaiting canvas.option.selected
```

### Data contracts (additions)

**`CanvasManifest`** (architect emits this in pass 2):
```ts
type CanvasManifest = {
  artifactKind: "frontend-app" | "backend-rest-api" | "backend-graphql" | "data-pipeline" | "mobile-app" | "cli-tool";
  modes: Array<{
    id: string;                       // "designing", "preview", "schema", "endpoints", ...
    renderer: string;                 // canvas-runtime registry id
    audience: PersonaTier[];          // ["ama","diego","priya"] | ["diego","priya"]
    default?: boolean;                // engine opens this mode first; only one default
    blockingFor?: "design" | "schema" | null; // when engine pauses awaiting selection
  }>;
};
```

**`InspirationBrief`** (Researcher → Designer):
```ts
type InspirationBrief = {
  category: string;                   // "restaurant-landing", "multi-tenant-saas-api"
  audienceCues: string[];             // ["fine-dining", "premium", "mumbai"]
  references: Array<{
    name: string;                     // "Bombay Canteen"
    url?: string;                     // "https://thebombaycanteen.com"
    why: string;                      // "Editorial serif + warm photography matched the premium signal"
    sourceTier: "local-catalog" | "web";
    palettePreview?: string[];        // hex codes, optional
    typographyPreview?: { primary: string; secondary?: string };
  }>;
  patternsThatWin: string[];          // ["above-the-fold reservation CTA", "menu in inline serif"]
  patternsThatLose: string[];         // ["stock photo carousels", "generic 'experience X' headlines"]
};
```

**`DesignProposal`** (Designer → ChatPanel via canvas event):
```ts
type DesignProposal = {
  recommended: DesignDirection;
  alternates: [DesignDirection, DesignDirection]; // exactly 2
  reasoning: string;                  // shown under the recommended card
};
type DesignDirection = {
  id: string;                         // "editorial-dark"
  name: string;                       // "Editorial Dark"
  shortDescription: string;           // ama-tier copy
  technicalDescription: string;       // diego-tier copy
  citedReferences: string[];          // names from InspirationBrief
  tokens: DesignTokens;
};
type DesignTokens = {
  palette: { primary: string; accent: string; surface: string; text: string; muted: string };
  typeScale: { sansFamily: string; serifFamily?: string; monoFamily: string; baseSizePx: number; scale: "minor-third" | "major-third" | "perfect-fourth" };
  density: "compact" | "comfortable" | "spacious";
  componentSet: "shadcn" | "radix-bare" | "custom";
  imageryStrategy: "photo" | "illustration" | "abstract-gradients" | "none";
  copyVoice: "premium" | "friendly" | "authoritative" | "playful";
};
```

**`VisualQualityReport`** (gate output):
```ts
type VisualQualityReport = {
  passed: boolean;
  score: number;                      // 0..100
  issues: Array<{
    severity: "critical" | "major" | "minor";
    category: "contrast" | "alignment" | "hierarchy" | "copy" | "design-token-drift";
    message: string;
    elementSelector?: string;
  }>;
  screenshotUrl: string;              // stored in spec_events for diff history
};
// constraint: any "critical" issue → passed = false (mirrors Security/A11y)
```

**Ritual events added** (extend `RitualEventType`):
- `architect.canvas_manifest.emitted`
- `researcher.brief.completed` / `researcher.brief.failed`
- `designer.proposal.emitted` / `designer.proposal.failed`
- `canvas.options.requested` (engine paused awaiting selection)
- `canvas.option.selected` (user picked) / `canvas.refinement.started` / `canvas.refinement.completed`
- `visual_quality.gate.passed` / `visual_quality.gate.failed`

---

## Persona awareness

Existing infra: `PersonaTier` = `"ama" | "diego" | "priya"` (`packages/ritual-engine/src/personas.ts`), `PersonaPreferences.resolveFor(userId, projectId)` already returns the right tier, atlas-web has a persona toggle. F.1 Bootstrap Checkpoint already asks at project-creation time.

This spec adds two persona-aware hooks:

1. **Mode set filter** — `personaFilter(manifest, persona)` in `@atlas/canvas-runtime` returns the manifest with modes whose `audience` includes the resolved persona. ama only ever sees `["designing","preview"]`. diego adds `["schema"]`. priya adds `["endpoints","exerciser","logs"]` (those land v2 — gracefully absent in v1 but `audience` already declared).

2. **Renderer tier** — every renderer accepts a `persona` prop and switches between `<OutcomeCard>` (ama) and `<TechnicalCard>` (diego/priya) sub-components. Same `DesignDirection` data, different copy + visual emphasis. The Backend Schema canvas is the canonical persona-tiered case: ama sees "🛡️ Each customer fully isolated"; diego sees `tenants(id uuid pk) · users(tenant_id FK) · todos(tenant_id FK) · + RLS USING tenant_id`.

Persona toggle live-flips the canvas (no ritual restart needed). Renderers re-render against the new persona; the underlying artifact is unchanged.

---

## Sandbox uplift (the precondition)

The fastest way to break out of inline-style purgatory: **rebuild the E2B template image so the deps the prompt assumes really are installed.** Two coordinated changes:

1. **`packages/sandbox-e2b/templates/atlas-next-ts/`** — package.json gains `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer`, `lucide-react`, `framer-motion`, `clsx`, `tailwind-variants`, `class-variance-authority`, plus the shadcn/ui CLI base + a curated subset of components (`button`, `card`, `input`, `label`, `dialog`, `dropdown-menu`, `tabs`, `tooltip`, `badge`, `separator`, `skeleton`). `globals.css` retains the `@tailwind` directives. `tailwind.config.ts` extends with the design-token CSS-variable scaffolding so renderer outputs map cleanly onto user-chosen tokens.

2. **`SANDBOX_CONTEXT_PROMPT`** (`packages/role-developer/src/assemble-prompt.ts`) — rewritten from "NO Tailwind, NO lucide-react, NO framer-motion" to a positive list:
   - Tailwind 3.x is installed and globals.css imports its directives. Use utility classes freely.
   - shadcn/ui components are available at `@/components/ui/*` (button, card, input, ...).
   - lucide-react for icons; framer-motion for animation.
   - Design tokens for the chosen direction are exposed as CSS variables in globals.css; reference via `var(--atlas-color-primary)` etc.
   - Inline `style={{ }}` is the fallback only when no token exists for the property.

3. **E2B template republish** — `packages/sandbox-e2b/scripts/build-template.sh` rebuilds + tags `atlas-next-ts:vN+1`. Previous tag stays available for rollback. `ATLAS_DEFAULT_SANDBOX_TEMPLATE` env var pin moves to the new tag in the same PR.

This change alone — independent of canvas/Designer work — would lift Tier-A output to mid-Tier-B for free, because the developer model stops being told "you can't use modern tools."

---

## Visual-Quality merge gate (L7-visual-advisory)

Mirrors the Security (L4) and A11y (L5) gate-runner shape. Lands inside the existing `postDeveloperChain` (Plan I).

**Trigger:** after `sandbox.apply.completed` for any ritual whose canvas manifest included a `design`-blocking mode (i.e., a design selection happened). Skipped for backend-only or refactor scopes.

**Steps:**
1. Hit the sandbox preview URL via `puppeteer-core` running inside E2B (template ships chromium); take three screenshots: desktop (1280×800), tablet (768×1024), mobile (375×667).
2. Stash bytes in `spec_events.payload` for history (small enough at < 100KB JPEG; stored opaque). Object-storage adapter optional follow-up.
3. LLM critique pass via the existing `@atlas/llm-provider` plumbing (same model precedence as Security gate). Skill prompt composes `critique-design-tokens` + `critique-hierarchy` + `critique-copy` from the new `skill-library/skills/visual-quality/` family.
4. The critique includes the chosen `DesignTokens` so it can flag drift ("recommended palette is editorial-dark with #fbbf24 accent; rendered hero uses #f97316 — token drift").
5. Returns `VisualQualityReport`. Critical issues → `passed=false` → Plan L auto-fix loop fires the same way Security/A11y gate failures already do.

**Risk-accept tier:** L7-visual-advisory is `ama`-tier accept (matches `L6-a11y-advisory`). Visual quality is taste-driven; the user is sovereign.

**v1 cost ceiling:** capped per-ritual via existing spend reader. Default model = same Sonnet as the architect; downgrade to Haiku via `ATLAS_VQ_GATE_MODEL` if a project hits its cap.

---

## Polymorphic canvas — the right-zone shell

Replaces the current Plan R right panel (which only ever rendered the preview iframe) with `<CanvasShell>` that:

1. Reads `canvasManifest` from the latest ritual snapshot (via `useRitualSnapshot()` — extends the Plan H hydrator output).
2. Filters via `personaFilter(manifest, persona)`.
3. Renders a top-right `<ModeToggle>` showing only filtered modes.
4. Mounts the active renderer from `CanvasModeRegistry`.
5. Listens for engine `canvas.options.requested` events → auto-switches to the requested mode (Q1 = auto-switch confirmed).
6. Listens for `sandbox.apply.completed` events → auto-switches back to `preview` mode if the user hasn't manually overridden.
7. The toggle exposes manual override; user override is sticky for the ritual.
8. When no manifest is available (older rituals, flag-OFF), falls back to today's preview-only behavior — no regression.

The `<EmptyCanvas>` surface for "ritual not started yet" replaces the empty iframe with a tasteful Geist-style placeholder echoing the chat panel's prompt.

---

## A2UI primitive

Three composable React components in `apps/atlas-web/components/a2ui/`:

- **`<OptionsCard>`** — generic Pattern C card. Props: `recommended: Card, alternates: Card[], onSelect(id), onRefine(id), persona`. Card sub-component branches on persona to render `<OutcomeCard>` (ama) or `<TechnicalCard>` (diego/priya). Used by `DesignerCanvas` and `SchemaCanvas` in v1; reusable for any future "pick one of N" surface (also serves architect blocking-questions per Q2 = canvas-for-everything).

- **`<AxisWizard>`** — generic Pattern B card. Props: `axes: Array<{ id, label, options: AxisOption[], educationalTooltip: string }>, onComplete(selection)`. Drives the Refine flow inside `DesignerCanvas`. Per the user's "fun + educational" steer, axis options carry `name` (e.g., "Riad Sunset"), `swatchPreviewSvg`, `educationCopy` ("Warm earth tones inspired by Marrakech homes — pairs well with serif headlines"), and `funFact`.

- **`<OutcomeCard>` / `<TechnicalCard>`** — leaf renderers. Different visual emphasis for the same `Card` payload. ama-tier hides code/SQL; diego-tier shows them inline; priya-tier exposes "Show internals" for full DesignTokens dump.

---

## Researcher + Designer roles

Both follow the established Role pattern (`packages/role-architect/`, `packages/role-developer/`):

- TS package, `RoleId` constant, implements `Role` from `@atlas/conductor`, registers in atlas-web's `factory.ts` behind feature flag, full unit tests + observability.
- Same prompt-cache pattern (3-tier blocks via `buildPromptCacheBlocks`) as Architect.
- Tool-use schema enforced via Zod after the LLM call.
- Returns scope-shaped artifact extending `RoleResult`.

**ResearcherRole:**
- Input: `{ designIntent, ambiguity, mode }`.
- Step 1: query `LocalCatalog` for matching category (`restaurant-landing`, `multi-tenant-saas-api`, ...). Catalog is YAML files in `packages/skill-library/skills/designer/catalog/`. Returns 0–N reference entries.
- Step 2 (only when `ATLAS_RESEARCH_WEB=1` AND mode !== "fast"): call Brave Search Adapter for "best <category> 2026" + scrape OG images from top 5 results via `node-fetch` (no headless browser at this layer — keep it cheap). Cap budget per ritual.
- Step 3: LLM call (Haiku) folds `localHits + webHits` into a `InspirationBrief` Zod-validated payload. Returns.
- **Fast-mode short-circuit:** skip steps 2+3, return a minimal brief composed from local catalog only; if local catalog is empty, brief is `null` and Designer proceeds without it.

**DesignerRole:**
- Input: `{ artifact, brief, designIntent, persona }`.
- Single LLM call (Sonnet) with tool-use; emits `DesignProposal` with exactly 1 recommendation + 2 alternates. Reasoning cites brief references by name. Each alternate has full `DesignTokens`.
- Refinement is a separate method `DesignerRole.refine(direction, axis, choice)` for the AxisWizard path.
- Persona is *not* passed to the LLM — proposal is persona-agnostic. The renderer chooses framing.

---

## Local reference catalog

Lives in `packages/skill-library/skills/designer/catalog/`. One YAML per category:

```yaml
# restaurant-landing.yaml
category: restaurant-landing
synonyms: [restaurant-website, dining-landing, cafe-website]
references:
  - name: The Bombay Canteen
    url: https://thebombaycanteen.com
    why: Editorial serif headlines, warm photography, prominent reservation CTA
    palette: ["#0a0a0a", "#fbbf24", "#fef3c7", "#1f2937"]
    typography:
      primary: "IBM Plex Serif"
      secondary: "Inter"
    density: spacious
    notes: "Typifies premium-Indian-restaurant aesthetic. Hero gives 60% to a single dish."
  - name: Eleven Madison Park
    ...
patternsThatWin:
  - above-the-fold reservation CTA
  - one hero photograph at high quality, not a carousel
  - menu shown inline on the homepage, not behind a click
patternsThatLose:
  - stock-photo carousels
  - generic "experience finest cuisine" headlines
  - hero video with autoplay
```

**v1 catalog** ships ~30 categories covering: restaurant-landing, saas-marketing, dashboard-admin, portfolio-personal, e-commerce-product, blog-publication, documentation, agency-creative, nonprofit, education-course, multi-tenant-saas-api, single-tenant-internal-tool, data-pipeline-etl, marketing-event, mobile-app-marketing, healthcare-clinic, government-service, fintech-marketing, contact-form-only, login-screen, dashboard-analytics, crm-internal, marketplace-two-sided, news-publication, podcast-show, b2b-landing, status-page, changelog-page, pricing-page, careers-page.

Authoring: hand-curated initially. ~3 references per category, ~50 entries total. Each YAML ~80–120 lines. Total catalog size: ~3,000–6,000 lines of YAML — fits in one CI lint pass.

---

## Web research adapter (optional, behind `ATLAS_RESEARCH_WEB=1`)

`@atlas/role-researcher`'s `WebFetchAdapter` interface; v1 ships a `BraveSearchAdapter` (free tier 2k queries/month). The adapter:

1. Issues one query per ritual: `"best <category> websites 2026"`.
2. Parses top-5 results.
3. For each, fetches the URL with `node-fetch` (timeout 5s), extracts OG image URL + meta description from HTML head only (no DOM rendering, no headless browser).
4. Returns `WebHit[]` to the role.

Failures return empty array — the local catalog covers the floor.

Caching: per-category-per-week LRU in Postgres (`design_research_cache` table). One column per `WebHit` field. TTL configurable.

---

## Testing strategy

The user's explicit requirement: **tests for everything, including visual, all locally runnable**. Three layers.

### 1. Unit tests (vitest)

Per package, mirroring existing convention:

- `@atlas/role-researcher` — local-catalog hit/miss, web-fetch retry/cap, brief schema validation, fast-mode short-circuit.
- `@atlas/role-designer` — proposal-shape (1 + exactly 2 alternates), reasoning-cites-brief invariant, refine-axis-merge.
- `@atlas/canvas-runtime` — manifest schema, persona-filter, registry registration/lookup, event-type unions.
- `@atlas/gate-visual-quality` — runner.run shape, critique-LLM mocked, screenshot byte-handling, critical→passed=false constraint, persona-tier accept enforcement.
- `apps/atlas-web` per-component vitest:
  - `<CanvasShell>` — manifest-driven mode rendering, persona filter, auto-switch on event, manual override sticky.
  - `<OptionsCard>` / `<AxisWizard>` / `<OutcomeCard>` / `<TechnicalCard>` — each variant.
  - `<DesignerCanvas>` / `<SchemaCanvas>` / `<RefineWizard>`.
  - `use-canvas-state` / `use-design-selection` hooks.

Coverage target: every exported symbol has at least one test. Match the C.3 / D.4 / D.5 conventions.

### 2. Integration tests (vitest)

- `packages/ritual-engine/test/engine-canvas-flow.test.ts` — architect → researcher (mocked) → designer (mocked) → engine pauses → emit `canvas.option.selected` → developer dispatches with `priorArtifact.selectedTokens` → developer mock returns diff → applyDiff stub → visual-quality gate (mocked) passes/fails.
- `apps/atlas-web/test/integration/canvas-flow.test.tsx` — full ChatPanel + CanvasShell integration with stubbed engine; renders cards, click-to-select dispatches the right server action.
- Per-persona integration tests — same flow under `ama`, `diego`, `priya`; assert mode set + renderer copy differ.

### 3. Visual regression tests (Playwright snapshots)

Add `apps/atlas-web/e2e/visual/` directory. Snapshots committed to repo as PNG (Playwright default; reviewable via PR diff). One spec per renderer × per persona × per viewport. Examples:

- `designer-canvas-pattern-c.spec.ts` — feeds canned `DesignProposal`, screenshots `<DesignerCanvas>`, expect-toHaveScreenshot per persona × viewport (3 personas × 3 viewports = 9 baselines per renderer).
- `refine-wizard-palette-step.spec.ts` — same pattern.
- `schema-canvas-tenants-rls.spec.ts` — backend canvas, diego + priya only (ama doesn't see this mode).
- `outcome-card-tenancy.spec.ts` — ama-tier card.
- `mode-toggle-states.spec.ts` — designing/preview/schema active states.

Plus end-to-end visual tests of an actual generated output:

- `e2e/visual/generated-restaurant-landing.spec.ts` — runs a full ritual against a deterministic-mock LLM, applies the diff to a fixture sandbox URL, screenshots desktop/tablet/mobile, expects against committed baselines. Catches regressions where prompt changes silently degrade output.

**Tooling:** Playwright's built-in `toHaveScreenshot()` (no extra dep). Threshold: 0.1% pixel diff with `maxDiffPixels: 100`. Baselines stored in `apps/atlas-web/e2e/visual/__snapshots__/` (in-repo, reviewable). Update via `pnpm --filter atlas-web test:visual --update-snapshots`.

**Commands:**
- `pnpm --filter atlas-web test:visual` — runs the visual suite locally (auto-starts dev server).
- `pnpm --filter atlas-web test:visual:update` — regenerates baselines.
- `pnpm -r test` — runs unit + integration; visual is opt-in to keep CI fast.
- CI workflow `.github/workflows/visual-regression.yml` runs the visual suite on PRs to `main` only when files in scope (`apps/atlas-web/**`, `packages/canvas-runtime/**`, etc.) change. Fails the PR on diff mismatch; uploads diff artifacts for review.

### 4. Accessibility tests (existing infra)

`@axe-core/playwright` integrations in the visual specs. Each canvas renderer's snapshot also passes axe. The L5 A11y gate already runs during ritual; this layer is for the React components themselves.

---

## Feature flags & rollout

Single new flag wraps the whole feature: **`ATLAS_FF_CANVAS_V1=true`**. When OFF (default), the existing pipeline runs unchanged; the canvas shell stays in preview-only mode (Plan R behavior preserved byte-for-byte).

Sub-flags inside the umbrella for staged enablement:
- `ATLAS_FF_RESEARCHER=true` — Researcher dispatched. Without it, Designer runs against empty brief.
- `ATLAS_FF_DESIGNER=true` — Designer dispatched.
- `ATLAS_FF_VISUAL_QUALITY_GATE=true` — Visual-Quality gate runs after sandbox.apply.
- `ATLAS_RESEARCH_WEB=true` — Web fetch adapter activates inside Researcher.
- `ATLAS_FF_CANVAS_V1` is the umbrella; the others are independent dials to enable per-component for staged rollout / testing.

Flag-OFF behavioural lock test pattern (matching Plan E.0 / Plan R precedent): first test that lands. Renders `<ProjectLayout>` with all flags OFF, asserts exact-DOM match to today's Plan R output (no `<CanvasShell>`, no `<ModeToggle>`, no canvas registry imports in the bundle).

Rollout sequence:
1. Sandbox uplift first (independent of flags) — sandbox can be republished without enabling any new role.
2. Researcher + Designer roles ship behind their flags, off by default.
3. Canvas shell + A2UI primitive ship behind `ATLAS_FF_CANVAS_V1`, off by default.
4. Visual-Quality gate ships behind its flag, off by default.
5. Demo runbook (`docs/superpowers/demo-runbook.md`) updated to flip everything on for the demo path.
6. Default-on cutover: separate small PR after a soak window with flags on in dev.

---

## Failure modes & error handling

| Failure | Detection | Behavior |
|---|---|---|
| Researcher web-fetch timeout | timeout in `BraveSearchAdapter` | Falls back to local-catalog-only brief; emits `researcher.brief.completed` with `sourceTier: "local-only"` flag |
| Local catalog has no entries for category | `LocalCatalog.lookup` returns empty | Brief is empty; Designer prompt notes "no references available — use general principles" |
| Designer LLM timeout / tool-use parse failure | `DeepPlanFailedError`-shaped error in role | Engine emits `designer.proposal.failed`; ChatPanel renders red `role="alert"`; ritual continues to developer with NO design-token override (developer falls back to safe-default Tier B) |
| Canvas shell rendered before manifest available | `useRitualSnapshot` returns `manifest: undefined` | Renders `<EmptyCanvas>` placeholder; flips to active mode when manifest arrives |
| User never clicks "Use this →" (page closed mid-ritual) | engine's pause-with-timeout (default 30 min) | After timeout: engine auto-selects the recommended direction, emits `canvas.option.auto_selected`, ritual proceeds |
| Visual-Quality gate's screenshot fails (sandbox died) | E2B exec exception | Gate emits `passed: true` with a warning issue; doesn't block the ritual |
| Visual-Quality critique LLM returns malformed schema | Zod parse fail | Same path as Security/A11y gate parse fail — emits `gate.failed` with cause; Plan L auto-fix considers it a gate failure |
| Persona not yet resolved when manifest arrives (race) | `personaFilter` called with `null` | Defaults to `ama` (most restrictive mode set); re-renders when persona arrives |
| Old ritual without `canvasManifest` (Plan H hydration of pre-feature ritual) | `manifest: undefined` in snapshot | Canvas shell falls back to today's preview-only — graceful no-op |

---

## Migration / data

- **No DB migrations required** — `canvasManifest`, `inspirationBrief`, `designProposal`, `selectedTokens`, `visualQualityReport` all ride inside `RitualSnapshot.payload` (JSONB column already exists).
- **Optional follow-up table** `design_research_cache(category, payload, fetched_at)` if web-research caching turns out to matter — not required at v1.
- **Optional follow-up table** `visual_quality_screenshots(ritual_id, viewport, sha256, bytes)` if we move screenshot bytes out of `spec_events.payload` — not required at v1.

---

## v1 / v2 / v3 cut

**v1 (this plan):**
- Sandbox uplift (Tailwind+shadcn+lucide really installed)
- Researcher (local catalog + optional Brave adapter behind `ATLAS_RESEARCH_WEB`)
- Designer (Pattern C proposal + Pattern B refine)
- Canvas shell (polymorphic, persona-aware, frontend modes: Designing + Preview)
- Backend Schema canvas mode (persona-tiered: outcome cards for ama, schema cards for diego/priya)
- A2UI primitive (`OptionsCard`, `AxisWizard`, `OutcomeCard`, `TechnicalCard`)
- Visual-Quality merge gate (L7-visual-advisory)
- Tests: unit + integration + Playwright visual snapshots per renderer × persona × viewport
- Local catalog: ~30 categories
- Behind `ATLAS_FF_CANVAS_V1` umbrella, sub-flags for staged enablement, default OFF in code

**v2 (separate plans):**
- Backend Endpoints / Exerciser / Logs canvas modes
- Mobile and data-pipeline canvas modes
- Persistent inspiration cache + automatic catalog growth from approved web-research hits
- Visual-Quality gate's image-to-LLM model upgraded to Opus when budget allows
- Per-component visual-edit overlay (Lovable-style click-to-edit)

**v3 (further out):**
- Multi-tenant brand-kit injection
- Per-customer style transfer (persistent design system across all that customer's projects)

---

## Open questions

1. **Brave Search vs. SerpAPI vs. Bing Web Search vs. Google Programmable Search** — any preference, or pick at implementation time on cost? (Brave is currently leading on free tier — 2k queries/month.)
2. **Should the Visual-Quality gate's screenshot be image-to-LLM (multimodal Sonnet) or text-extraction-then-critique?** Multimodal is more accurate but ~3× the token cost. Recommendation: image-to-LLM with `ATLAS_VQ_GATE_MODEL` overrideable per project.
3. **Screenshot baseline storage** — in-repo PNGs is the simplest (Playwright default, reviewable in PRs); for the ~150 baselines this v1 produces, that's ~3-5 MB total. If repo-size becomes a concern later, move to `git-lfs` or a Chromatic-style external. Recommendation: in-repo for v1.
4. **Does the catalog ship as YAML or as TS modules?** YAML is editor-friendly and lint-checkable; TS is type-safe at compile time. Recommendation: YAML with a `catalog-validate` script that runs in CI and a generated TS index.

These are implementation choices; defaults will be picked by the implementing engineer unless flagged here.

---

## Sources

- Existing personas — `packages/ritual-engine/src/personas.ts`
- Existing role pattern — `packages/role-architect/`, `packages/role-developer/`, `packages/role-security/`, `packages/role-accessibility/`
- Existing gate-runner pattern — `packages/role-security/src/gate-runner.ts`
- Existing E2B template — `packages/sandbox-e2b/templates/atlas-next-ts/`
- Plan R (right-zone shell, persona toggle) — `docs/superpowers/plans/2026-04-30-plan-r-editor-layout-v2.md`
- Plan I (post-developer chain) — `docs/superpowers/plans/2026-04-28-plan-i-register-roles.md`
- Plan L (auto-fix loop) — `docs/superpowers/plans/2026-04-29-plan-l-developer-fix-loop.md`
- A2UI deferred research, referenced in `docs/superpowers/local-dev-status.md` ("Dynamic UI for blocking questions")
- shadcn/ui — https://ui.shadcn.com
- Tailwind CSS — https://tailwindcss.com
- Brave Search API — https://api.search.brave.com
- Playwright visual comparisons — https://playwright.dev/docs/test-snapshots
- Vercel Geist Design System — https://vercel.com/geist/introduction
