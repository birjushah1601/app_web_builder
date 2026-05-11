# Plan S.4 — Polymorphic Canvas + Engine Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Researcher (S.2) and Designer (S.3) into the live RitualEngine pipeline behind a single umbrella feature flag (`ATLAS_FF_CANVAS_V1`); ship a new `@atlas/canvas-runtime` package whose `CanvasManifest` schema, persona filter, and mode registry let the renderer side select what to show without learning every role's vocabulary; replace Plan R's preview-only right panel with a polymorphic `<CanvasShell>` that auto-switches mode on engine `canvas.options.requested` events, lets the user pick from full-size design cards, refines via an axis wizard, falls back to the existing preview iframe after `sandbox.apply.completed`, and (for backend rituals) exposes a persona-tiered Schema picker. Engine pauses the ritual between Designer and Developer so the user has time to decide; auto-selects the recommended direction on a 30-minute timeout. Architect output extended with `designIntent` + `canvasManifest` so the canvas is driven by the same artifact the architect already emits.

**Architecture:** Three packages move in coordination. **(1)** New `packages/canvas-runtime/` carries the data contracts (`CanvasManifestSchema`, `CanvasModeSchema`), the persona filter (`personaFilter(manifest, persona)` returning a manifest narrowed to the persona's allowed modes), the renderer registry (`CanvasModeRegistry.register(id, fn)` + `lookup(id)` + `list()`), and the canvas-event Zod union extending `RitualEventType`. Pure TS, no React. **(2)** `packages/ritual-engine/src/engine.ts` gains a `canvas-pause.ts` primitive (`waitForOption({ ritualId, timeoutMs }) → Promise<{ tokens } | { auto: true }>`) and is extended in `_runRitual`: after the architect emits an artifact with a `canvasManifest` containing a design-blocking mode AND `ATLAS_FF_CANVAS_V1` is on, the engine dispatches Researcher (if `ATLAS_FF_RESEARCHER`) → Designer (if `ATLAS_FF_DESIGNER`) → emits `canvas.options.requested` carrying the proposal → calls `waitForOption` → resumes by dispatching Developer with `{ ...artifact, selectedTokens }` as `priorArtifact`. The pause uses an in-memory promise registry (Map<ritualId, deferred>) so a Server Action call to `selectDesignDirection(ritualId, tokens)` can resolve it. The Hydrator is extended to fold `canvas.option.selected` events into the snapshot. **(3)** atlas-web's right panel is replaced by `<CanvasShell>` which reads `canvasManifest` from the snapshot via the Plan H hydrator output, runs `personaFilter`, mounts the active renderer from `CanvasModeRegistry`, and listens to the `EventBroker` for engine canvas events. Five renderers ship: `<DesignerCanvas>` (wraps S.3's `<OptionsCard>` at full canvas size), `<RefineWizard>` (wraps S.3's `<AxisWizard>` with palette/typography/density axes), `<PreviewCanvas>` (wraps the existing `CanvasPreviewClient`), `<SchemaCanvas>` (persona-tiered backend schema picker), and an `<EmptyCanvas>` placeholder for pre-ritual state. A `<ModeToggle>` segmented control sits top-right showing only persona-allowed modes; manual override is sticky for the ritual.

**Tech Stack:** TypeScript 5.6 · Node 22 · Zod 3.23 · React 19 · Next.js 15.5 · vitest 2.1 · `@atlas/ritual-engine` + `@atlas/conductor` + `@atlas/role-researcher` (S.2) + `@atlas/role-designer` (S.3) + `@atlas/canvas-runtime` (NEW, this plan) workspace deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan S.2 merged to `main` (`@atlas/role-researcher` + `InspirationBriefSchema` + `ATLAS_FF_RESEARCHER` + factory wire-up).
- Plan S.3 merged to `main` (`@atlas/role-designer` + `DesignProposalSchema` + `DesignTokensSchema` + `<OptionsCard>` / `<AxisWizard>` / `<OutcomeCard>` / `<TechnicalCard>` + `ATLAS_FF_DESIGNER` + factory wire-up).
- Repo state: on `main`, working tree clean, `pnpm -r test` green.
- `pnpm` 9 + Node 22.

**Branch:** `plan-s4/canvas-engine` cut from `main`. Final task in this plan merges back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/canvas-runtime/                                # NEW PACKAGE
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts                                            # public exports
    types.ts                                            # CanvasManifestSchema, CanvasModeSchema, helpers
    persona-filter.ts                                   # personaFilter(manifest, persona)
    registry.ts                                         # CanvasModeRegistry (register/lookup/list)
    events.ts                                           # CanvasEventSchema (architect.canvas_manifest.emitted, canvas.*, designer.*, researcher.*) + extends RitualEventSchema
  test/
    types.test.ts                                       # 8 cases — schema parse, default helper, edge cases
    persona-filter.test.ts                              # 6 cases — ama/diego/priya, null persona, empty manifest, all-mode manifest
    registry.test.ts                                    # 4 cases — register/lookup/list/duplicate-id-throws
    events.test.ts                                      # 5 cases — every new event-type round-trips through Zod

packages/ritual-engine/
  src/
    engine.ts                                           # MODIFIED — Researcher → Designer dispatch + canvas pause + selected-tokens fold
    canvas-pause.ts                                     # NEW — pause primitive (Map<ritualId, deferred> + timeout → auto-select recommended)
    hydrator.ts                                         # MODIFIED — fold canvas.option.selected + designer.proposal.emitted into snapshot
    events.ts                                           # MODIFIED — extend RitualEventSchema discriminated union with canvas.* events (re-export from canvas-runtime)
    index.ts                                            # MODIFIED — re-export waitForOption + CanvasOptionSelected types
  test/
    canvas-pause.test.ts                                # 6 cases — resolves on selected, times out → auto-select, double-resolve guard, dispose, unknown ritualId, race
    engine-canvas-flow.test.ts                          # NEW — integration: architect → researcher (mocked) → designer (mocked) → pause → selected → developer → assert priorArtifact carries selectedTokens
    engine-canvas-flag-off.test.ts                      # NEW — flag OFF → today's behavior preserved byte-for-byte (no researcher/designer dispatch)
    hydrator-canvas.test.ts                             # NEW — replays canvas.option.selected → snapshot.selectedTokens populated
    canvas-pause-timeout.test.ts                        # 3 cases — 30-min default, custom timeout, recommended fallback contents

apps/atlas-web/
  components/canvas/                                    # NEW directory
    CanvasShell.tsx                                     # NEW — bimodal/polymorphic shell, replaces Plan R right-panel content
    ModeToggle.tsx                                      # NEW — top-right segmented control
    EmptyCanvas.tsx                                     # NEW — pre-ritual placeholder
    register-renderers.tsx                              # NEW — boot-time CanvasModeRegistry.register() calls for the 4 v1 renderers
    renderers/
      DesignerCanvas.tsx                                # NEW — wraps S.3 <OptionsCard> at full canvas size
      RefineWizard.tsx                                  # NEW — wraps S.3 <AxisWizard> with Designer-specific axes
      PreviewCanvas.tsx                                 # NEW — wraps existing CanvasPreviewClient (keeps it import-stable)
      SchemaCanvas.tsx                                  # NEW — backend Schema picker, persona-tiered
  lib/canvas/
    use-canvas-state.ts                                 # NEW — client-side mode state (auto-switch on event + manual override sticky)
    use-design-selection.ts                             # NEW — observes canvas.option.selected events for current ritual
    select-design-direction.ts                          # NEW — Server Action that calls engine's resolve() to unpause
  lib/engine/
    factory.ts                                          # MODIFIED — register ResearcherRole + DesignerRole behind their flags; pass canvasFlowEnabled + canvasResolver
    spec-events-hydrator.ts                             # MODIFIED — pass through new canvas event types
  lib/events/EventBroker.ts                             # MODIFIED — extend RitualEventType union with canvas.* events
  lib/feature-flags.ts                                  # MODIFIED — register "canvas-v1" flag
  app/projects/[projectId]/canvas/page.tsx              # MODIFIED — wraps in <CanvasShell> when flag on; preserves preview-only when flag off
  test/components/canvas/CanvasShell.test.tsx           # NEW — 6 cases — flag-OFF behavior, manifest-driven mode rendering, persona filter, auto-switch on event, manual override sticky, fallback to <EmptyCanvas>
  test/components/canvas/ModeToggle.test.tsx            # NEW — 4 cases — render filtered modes, click switches mode, active state, ARIA roles
  test/components/canvas/EmptyCanvas.test.tsx           # NEW — 2 cases — copy + accessible region
  test/components/canvas/renderers/DesignerCanvas.test.tsx   # NEW — 4 cases — renders proposal, click-to-select fires action, refine click fires action, persona-driven copy
  test/components/canvas/renderers/RefineWizard.test.tsx     # NEW — 3 cases — palette/typography/density axes, complete fires action with merged tokens
  test/components/canvas/renderers/SchemaCanvas.test.tsx     # NEW — 3 cases — ama=outcome cards, diego=schema cards, priya=schema cards
  test/components/canvas/renderers/PreviewCanvas.test.tsx    # NEW — 1 case — passes props through to CanvasPreviewClient
  test/lib/canvas/use-canvas-state.test.ts              # NEW — 4 cases — initial mode = manifest.default, auto-switch on event, manual-override sticky, sticky-cleared on new ritual
  test/lib/canvas/use-design-selection.test.ts          # NEW — 3 cases — observes selected event, ignores other rituals, returns undefined pre-selection
  test/lib/canvas/select-design-direction.test.ts       # NEW — 2 cases — calls engine.resolveCanvasOption with tokens, surfaces error
  test/lib/engine/factory-canvas-flag.test.ts           # NEW — 4 cases — flag OFF (no canvas roles), flag ON (researcher + designer registered), researcher-flag-only, designer-flag-only
  test/integration/canvas-flag-off-lock.test.tsx       # NEW — flag-OFF behavioural lock: rendered DOM matches Plan R byte-for-byte (no <CanvasShell>, no <ModeToggle>, no canvas-runtime in bundle)

packages/role-architect/
  src/
    types.ts                                            # MODIFIED — extend each ArchitectOutput variant with optional designIntent + canvasManifest fields
    deep-plan.ts                                        # MODIFIED — enrichArchitectOutput synthesizes a canvasManifest from artifactKind classification + emit architect.canvas_manifest.emitted event
    role.ts                                             # MODIFIED — emit architect.canvas_manifest.emitted in pass2.completed when manifest present
  test/
    types-canvas-fields.test.ts                        # NEW — 4 cases — schema accepts designIntent/manifest, accepts undefined, rejects bad shape, every scope variant
    deep-plan-canvas-manifest.test.ts                  # NEW — 4 cases — new-app → frontend manifest, multi-tenant API → backend manifest, refactor → no manifest, ship → no manifest
    role-canvas-event.test.ts                          # NEW — 2 cases — emits architect.canvas_manifest.emitted, payload validates against CanvasManifestSchema

docs/superpowers/
  local-dev-status.md                                   # MODIFIED — Plan S.4 entry under "What's wired"
```

**Why this shape.** `canvas-runtime` is a pure-TS package with no React dep so the Zod schemas + persona filter + registry can be imported by both server-side engine code and client-side renderer code without dragging React or Next.js into the engine bundle. Renderers live under `apps/atlas-web/components/canvas/renderers/` (one per mode id) so adding a new mode is a single new file + a single line in `register-renderers.tsx` — matches the spec's "adding a mode is shipping a new renderer, not changing the shell" goal. `canvas-pause.ts` lives in the engine package because the pause is a property of the ritual lifecycle, not the renderer; the renderer-side hook `use-design-selection` only observes events. The Server Action `select-design-direction.ts` is the bridge between the user click and the engine's resume — same pattern as `startRitual` / `refineRitual`. The flag-OFF lock test (`canvas-flag-off-lock.test.tsx`) is the first React test that lands per Plan E.0 / Plan R precedent: byte-for-byte regression guard.

---

## Design Decisions

These resolve implementation-level questions left implicit in the spec.

1. **Why pause-with-deferred-promise (vs. polling).** The engine already runs inside a Server Action's request lifetime via `getRitualEngine` (per-request cached). A Map<ritualId, deferred> in the engine instance lets `_runRitual` `await waitForOption(ritualId)` while a separate request to the Server Action `selectDesignDirection(ritualId, tokens)` calls `engine.resolveCanvasOption(ritualId, tokens)`. Both share the per-request engine instance via the cache. Polling adds unnecessary latency and DB load. The 30-min timeout matches the spec's "user never clicks → auto-select" contract.

2. **Why register canvas events in `canvas-runtime` AND extend the engine's discriminated union.** The Zod schemas live in `canvas-runtime` (single source of truth), but the engine's `RitualEventSchema` is the discriminated union the engine validates against. Engine imports the canvas event schemas and folds them into its union. This avoids a circular dep (canvas-runtime doesn't depend on ritual-engine) and keeps engine validation strict.

3. **Why the renderer registry is a runtime mutable singleton instead of a compile-time map.** The atlas-web app populates the registry at boot via `register-renderers.tsx`; v2 plans (mobile, data-pipeline, endpoints, exerciser, logs renderers) just add new files + new register calls without touching the shell. Mode-toggle visibility is data-driven from the manifest — when a renderer isn't registered for a mode the manifest declares, `<ModeToggle>` hides that mode and logs a warn (graceful degrade, not crash).

4. **Why architect emits the canvasManifest (not a separate role).** The spec calls for the architect to classify `artifactKind` in pass 2 anyway. Adding a manifest helper that maps `artifactKind` → modes (frontend → designing+preview, backend-rest-api → schema+endpoints, etc.) reuses the architect's classification. No new role; new fields on the existing artifact.

5. **Why persona null defaults to "ama" (not throw).** Plan H hydration race: snapshot may arrive before persona resolves. Defaulting to ama (most restrictive mode set) means the user never sees an admin-only mode by accident; the renderer re-renders cleanly when persona arrives.

6. **Why the Schema canvas ships in this plan (not deferred to v2 with the other backend modes).** The spec calls it the "canonical persona-tiered case" for the v1 cut. Without it, the polymorphic claim is unproven; we'd ship a polymorphic shell that only renders frontend modes. Schema is the cheapest backend mode to render (no live data, just the architect's `specGraph` rendered as either outcome cards or schema cards) and proves the architecture end-to-end.

7. **Why the pause is engine-side, not Server-Action-side.** The Server Action could in principle hold its connection open until selection, but Vercel/Next has request-timeout limits (default 60s). Engine-side pause means the Server Action that started the ritual returns immediately with the ritualId; the user's selection comes through a separate Server Action that resolves the deferred. Cleaner contract, no long-running HTTP requests.

8. **Why the Hydrator captures `selectedTokens` but NOT the full DesignProposal in the snapshot.** Storage discipline — the proposal can be re-derived from `designer.proposal.emitted` events on demand; the *selected* tokens are what downstream consumers (Developer prompt, Visual-Quality gate) need. Keeps `RitualSnapshot` lean.

9. **Why no rollback to "today's preview-only right panel" inside `<CanvasShell>` (vs. flag-gating at the `page.tsx` level).** `<CanvasShell>` is a no-op when no manifest is available; the page-level flag short-circuits the whole component swap. Two layers of safety: page flag OFF → no `<CanvasShell>` mounted at all (Plan R behavior); page flag ON + no manifest → `<EmptyCanvas>` placeholder; page flag ON + manifest → polymorphic render.

10. **Why the engine's resume uses `priorArtifact = { ...artifact, selectedTokens }` (vs. a new `priorContext` field).** Existing `Conductor.dispatch` shape — minimal API churn. Developer's prompt-assembly (S.1's positive-list rewrite) already references `priorArtifact`; adding `selectedTokens` as a top-level field on the artifact lets the developer's prompt simply read `priorArtifact.selectedTokens` without learning a new envelope shape.

---

## Task List (33 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Each task is independently committable and reviewable.

---

### Task 1: Cut branch + scaffold `@atlas/canvas-runtime` package

**Files:**
- Create: `(branch)`
- Create: `packages/canvas-runtime/package.json`
- Create: `packages/canvas-runtime/tsconfig.json`
- Create: `packages/canvas-runtime/vitest.config.ts`
- Create: `packages/canvas-runtime/README.md`

- [ ] **Step 1: Cut the branch from main**

```bash
cd /f/claude/ai_builder
git checkout main
git pull --ff-only
git checkout -b plan-s4/canvas-engine
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@atlas/canvas-runtime",
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
    "@atlas/ritual-engine": "workspace:*",
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
      "@atlas/canvas-runtime": path.resolve(__dirname, "src/index.ts")
    }
  }
});
```

- [ ] **Step 5: Create README.md**

```markdown
# @atlas/canvas-runtime

Polymorphic canvas data contracts shared between the RitualEngine (server) and the atlas-web `<CanvasShell>` (client).

- `CanvasManifest` — what the architect emits, declares which modes the canvas can render for this artifact.
- `personaFilter` — narrows a manifest to modes whose audience includes the user's persona.
- `CanvasModeRegistry` — runtime registry mapping mode-id → renderer (atlas-web populates at boot).
- `events` — Zod schemas for canvas/researcher/designer events that extend the engine's RitualEventSchema discriminated union.

No React. No Next.js. Pure TS + Zod.
```

- [ ] **Step 6: Install + verify workspace pickup**

```bash
pnpm install
```

Expected: pnpm reports `+ @atlas/canvas-runtime 0.0.0`.

- [ ] **Step 7: Commit**

```bash
git add packages/canvas-runtime/
git commit -m "chore(canvas-runtime): scaffold package + tsconfig + vitest"
```

---

### Task 2: Define `CanvasManifestSchema` + `CanvasModeSchema` + helpers (`types.ts`)

**Files:**
- Create: `packages/canvas-runtime/src/types.ts`
- Create: `packages/canvas-runtime/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/canvas-runtime/test/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CanvasManifestSchema,
  CanvasModeSchema,
  defaultManifestForArtifactKind,
  type CanvasManifest
} from "../src/types.js";

describe("CanvasModeSchema", () => {
  it("accepts a minimal valid mode", () => {
    const parsed = CanvasModeSchema.parse({
      id: "designing",
      renderer: "designing",
      audience: ["ama", "diego", "priya"]
    });
    expect(parsed.id).toBe("designing");
    expect(parsed.default).toBeUndefined();
  });

  it("rejects empty audience array", () => {
    expect(() =>
      CanvasModeSchema.parse({ id: "designing", renderer: "designing", audience: [] })
    ).toThrow();
  });

  it("accepts blockingFor + default", () => {
    const parsed = CanvasModeSchema.parse({
      id: "designing",
      renderer: "designing",
      audience: ["ama", "diego", "priya"],
      default: true,
      blockingFor: "design"
    });
    expect(parsed.blockingFor).toBe("design");
  });
});

describe("CanvasManifestSchema", () => {
  const valid: CanvasManifest = {
    artifactKind: "frontend-app",
    modes: [
      { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
      { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
    ]
  };

  it("parses a valid manifest", () => {
    expect(CanvasManifestSchema.parse(valid).modes).toHaveLength(2);
  });

  it("rejects manifest with no modes", () => {
    expect(() => CanvasManifestSchema.parse({ artifactKind: "frontend-app", modes: [] })).toThrow();
  });

  it("rejects more than one mode marked default", () => {
    expect(() =>
      CanvasManifestSchema.parse({
        ...valid,
        modes: [
          { ...valid.modes[0]!, default: true },
          { ...valid.modes[1]!, default: true }
        ]
      })
    ).toThrow(/only one default/i);
  });
});

describe("defaultManifestForArtifactKind", () => {
  it("frontend-app → designing+preview, designing default+blocking", () => {
    const m = defaultManifestForArtifactKind("frontend-app");
    expect(m.modes.map((mm) => mm.id).sort()).toEqual(["designing", "preview"]);
    const designing = m.modes.find((mm) => mm.id === "designing")!;
    expect(designing.default).toBe(true);
    expect(designing.blockingFor).toBe("design");
  });

  it("backend-rest-api → schema only (designing + preview not relevant)", () => {
    const m = defaultManifestForArtifactKind("backend-rest-api");
    expect(m.modes.map((mm) => mm.id)).toContain("schema");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/canvas-runtime test test/types.test.ts
```

Expected: FAIL — `Cannot find module '../src/types.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/canvas-runtime/src/types.ts`:

```ts
import { z } from "zod";
import { PersonaTierSchema } from "@atlas/ritual-engine";

export const ArtifactKindSchema = z.enum([
  "frontend-app",
  "backend-rest-api",
  "backend-graphql",
  "data-pipeline",
  "mobile-app",
  "cli-tool"
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const CanvasModeSchema = z.object({
  id: z.string().min(1),
  renderer: z.string().min(1),
  audience: z.array(PersonaTierSchema).min(1),
  default: z.boolean().optional(),
  blockingFor: z.enum(["design", "schema"]).nullable().optional()
});
export type CanvasMode = z.infer<typeof CanvasModeSchema>;

export const CanvasManifestSchema = z
  .object({
    artifactKind: ArtifactKindSchema,
    modes: z.array(CanvasModeSchema).min(1)
  })
  .superRefine((m, ctx) => {
    const defaults = m.modes.filter((mm) => mm.default === true);
    if (defaults.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only one mode may be marked default",
        path: ["modes"]
      });
    }
  });
export type CanvasManifest = z.infer<typeof CanvasManifestSchema>;

/** Architect helper — synthesize a sensible default manifest from artifactKind. */
export function defaultManifestForArtifactKind(kind: ArtifactKind): CanvasManifest {
  switch (kind) {
    case "frontend-app":
      return {
        artifactKind: kind,
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
        ]
      };
    case "backend-rest-api":
    case "backend-graphql":
      return {
        artifactKind: kind,
        modes: [
          { id: "schema", renderer: "schema", audience: ["ama", "diego", "priya"], default: true, blockingFor: "schema" }
        ]
      };
    default:
      return {
        artifactKind: kind,
        modes: [
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"], default: true }
        ]
      };
  }
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/canvas-runtime test test/types.test.ts
```

Expected: PASS — 8 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas-runtime/src/types.ts packages/canvas-runtime/test/types.test.ts
git commit -m "feat(canvas-runtime): CanvasManifestSchema + defaultManifestForArtifactKind"
```

---

### Task 3: `personaFilter` — narrow manifest to persona's allowed modes

**Files:**
- Create: `packages/canvas-runtime/src/persona-filter.ts`
- Create: `packages/canvas-runtime/test/persona-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/canvas-runtime/test/persona-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { personaFilter } from "../src/persona-filter.js";
import type { CanvasManifest } from "../src/types.js";

const FULL_MANIFEST: CanvasManifest = {
  artifactKind: "backend-rest-api",
  modes: [
    { id: "schema", renderer: "schema", audience: ["diego", "priya"], default: true },
    { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] },
    { id: "endpoints", renderer: "endpoints", audience: ["priya"] }
  ]
};

describe("personaFilter", () => {
  it("ama sees only modes that include ama in audience", () => {
    const filtered = personaFilter(FULL_MANIFEST, "ama");
    expect(filtered.modes.map((m) => m.id)).toEqual(["preview"]);
  });

  it("diego sees ama + diego modes", () => {
    const filtered = personaFilter(FULL_MANIFEST, "diego");
    expect(filtered.modes.map((m) => m.id).sort()).toEqual(["preview", "schema"]);
  });

  it("priya sees all modes", () => {
    const filtered = personaFilter(FULL_MANIFEST, "priya");
    expect(filtered.modes.map((m) => m.id).sort()).toEqual(["endpoints", "preview", "schema"]);
  });

  it("null persona defaults to ama", () => {
    const filtered = personaFilter(FULL_MANIFEST, null);
    expect(filtered.modes.map((m) => m.id)).toEqual(["preview"]);
  });

  it("preserves artifactKind + ordering", () => {
    const filtered = personaFilter(FULL_MANIFEST, "priya");
    expect(filtered.artifactKind).toBe("backend-rest-api");
    // ordering preserved relative to input
    expect(filtered.modes.map((m) => m.id)).toEqual(["schema", "preview", "endpoints"]);
  });

  it("returns manifest with empty modes when no mode matches", () => {
    const NO_MATCH: CanvasManifest = {
      artifactKind: "frontend-app",
      modes: [{ id: "x", renderer: "x", audience: ["priya"] }]
    };
    const filtered = personaFilter(NO_MATCH, "ama");
    expect(filtered.modes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/canvas-runtime test test/persona-filter.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/canvas-runtime/src/persona-filter.ts`:

```ts
import type { PersonaTier } from "@atlas/ritual-engine";
import type { CanvasManifest } from "./types.js";

/** Returns a manifest narrowed to modes whose audience includes the persona.
 *  Null persona defaults to "ama" (most restrictive). Pure function — input is
 *  not mutated. The returned `modes` array preserves input ordering. */
export function personaFilter(manifest: CanvasManifest, persona: PersonaTier | null): CanvasManifest {
  const effective: PersonaTier = persona ?? "ama";
  return {
    artifactKind: manifest.artifactKind,
    modes: manifest.modes.filter((m) => m.audience.includes(effective))
  };
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/canvas-runtime test test/persona-filter.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas-runtime/src/persona-filter.ts packages/canvas-runtime/test/persona-filter.test.ts
git commit -m "feat(canvas-runtime): personaFilter narrows manifest by audience"
```

---

### Task 4: `CanvasModeRegistry` — runtime renderer registry

**Files:**
- Create: `packages/canvas-runtime/src/registry.ts`
- Create: `packages/canvas-runtime/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/canvas-runtime/test/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { CanvasModeRegistry } from "../src/registry.js";

describe("CanvasModeRegistry", () => {
  let reg: CanvasModeRegistry<string>;
  beforeEach(() => {
    reg = new CanvasModeRegistry<string>();
  });

  it("register + lookup roundtrip", () => {
    reg.register("designing", "DesignerRenderer");
    expect(reg.lookup("designing")).toBe("DesignerRenderer");
  });

  it("lookup returns undefined for unknown id", () => {
    expect(reg.lookup("preview")).toBeUndefined();
  });

  it("list returns every registered id", () => {
    reg.register("designing", "A");
    reg.register("preview", "B");
    reg.register("schema", "C");
    expect(reg.list().sort()).toEqual(["designing", "preview", "schema"]);
  });

  it("register throws on duplicate id", () => {
    reg.register("designing", "A");
    expect(() => reg.register("designing", "B")).toThrow(/already registered/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/canvas-runtime test test/registry.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/canvas-runtime/src/registry.ts`:

```ts
/** Generic registry mapping mode-id → renderer. The renderer type is left
 *  abstract so server-side code can register data adapters and client-side
 *  code can register React components against the same shape. */
export class CanvasModeRegistry<R> {
  private readonly entries = new Map<string, R>();

  register(id: string, renderer: R): void {
    if (this.entries.has(id)) {
      throw new Error(`canvas mode "${id}" already registered`);
    }
    this.entries.set(id, renderer);
  }

  lookup(id: string): R | undefined {
    return this.entries.get(id);
  }

  list(): string[] {
    return Array.from(this.entries.keys());
  }
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/canvas-runtime test test/registry.test.ts
```

Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas-runtime/src/registry.ts packages/canvas-runtime/test/registry.test.ts
git commit -m "feat(canvas-runtime): CanvasModeRegistry runtime renderer registry"
```

---

### Task 5: Canvas event Zod schemas (`events.ts`)

**Files:**
- Create: `packages/canvas-runtime/src/events.ts`
- Create: `packages/canvas-runtime/test/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/canvas-runtime/test/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema,
  ArchitectCanvasManifestEmittedSchema,
  CanvasEventSchema
} from "../src/events.js";

describe("ArchitectCanvasManifestEmittedSchema", () => {
  it("parses a valid event", () => {
    const ok = ArchitectCanvasManifestEmittedSchema.parse({
      type: "architect.canvas_manifest.emitted",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: {
        manifest: {
          artifactKind: "frontend-app",
          modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
        }
      }
    });
    expect(ok.payload.manifest.artifactKind).toBe("frontend-app");
  });
});

describe("CanvasOptionsRequestedSchema", () => {
  it("requires proposal payload", () => {
    expect(() =>
      CanvasOptionsRequestedSchema.parse({
        type: "canvas.options.requested",
        ritualId: "r-1",
        ts: "2026-05-02T12:00:00Z",
        payload: {}
      })
    ).toThrow();
  });
});

describe("CanvasOptionSelectedSchema", () => {
  it("captures selected directionId + tokens", () => {
    const ok = CanvasOptionSelectedSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: {
        directionId: "editorial-dark",
        tokens: { palette: { primary: "#000", accent: "#fff", surface: "#fafafa", text: "#0a0a0a", muted: "#888" } },
        autoSelected: false
      }
    });
    expect(ok.payload.directionId).toBe("editorial-dark");
  });
});

describe("CanvasRefinementStartedSchema / CompletedSchema", () => {
  it("started carries axes list", () => {
    const ok = CanvasRefinementStartedSchema.parse({
      type: "canvas.refinement.started",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: { fromDirectionId: "editorial-dark", axes: ["palette", "typography", "density"] }
    });
    expect(ok.payload.axes).toContain("palette");
  });
});

describe("CanvasEventSchema (union)", () => {
  it("accepts every canvas variant", () => {
    const ev = CanvasEventSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: { directionId: "x", tokens: {}, autoSelected: false }
    });
    expect(ev.type).toBe("canvas.option.selected");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/canvas-runtime test test/events.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/canvas-runtime/src/events.ts`:

```ts
import { z } from "zod";
import { CanvasManifestSchema } from "./types.js";

const TsField = z.string();
const RitualIdField = z.string().min(1);

export const ArchitectCanvasManifestEmittedSchema = z.object({
  type: z.literal("architect.canvas_manifest.emitted"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    manifest: CanvasManifestSchema
  })
});

export const ResearcherBriefCompletedSchema = z.object({
  type: z.literal("researcher.brief.completed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    sourceTier: z.enum(["local-only", "local+web"]),
    referenceCount: z.number().int().nonnegative()
  })
});

export const ResearcherBriefFailedSchema = z.object({
  type: z.literal("researcher.brief.failed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({ error: z.string() })
});

export const DesignerProposalEmittedSchema = z.object({
  type: z.literal("designer.proposal.emitted"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    recommendedId: z.string().min(1),
    alternateIds: z.array(z.string()).length(2)
  })
});

export const DesignerProposalFailedSchema = z.object({
  type: z.literal("designer.proposal.failed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({ error: z.string() })
});

export const CanvasOptionsRequestedSchema = z.object({
  type: z.literal("canvas.options.requested"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    proposal: z.unknown(),
    manifest: CanvasManifestSchema
  })
});

export const CanvasOptionSelectedSchema = z.object({
  type: z.literal("canvas.option.selected"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    directionId: z.string().min(1),
    tokens: z.unknown(),
    autoSelected: z.boolean()
  })
});

export const CanvasRefinementStartedSchema = z.object({
  type: z.literal("canvas.refinement.started"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    fromDirectionId: z.string().min(1),
    axes: z.array(z.string()).min(1)
  })
});

export const CanvasRefinementCompletedSchema = z.object({
  type: z.literal("canvas.refinement.completed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    fromDirectionId: z.string().min(1),
    refinedTokens: z.unknown()
  })
});

export const CanvasEventSchema = z.discriminatedUnion("type", [
  ArchitectCanvasManifestEmittedSchema,
  ResearcherBriefCompletedSchema,
  ResearcherBriefFailedSchema,
  DesignerProposalEmittedSchema,
  DesignerProposalFailedSchema,
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema
]);
export type CanvasEvent = z.infer<typeof CanvasEventSchema>;
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/canvas-runtime test test/events.test.ts
```

Expected: PASS — 5 cases.

- [ ] **Step 5: Wire `index.ts` exports**

Create `packages/canvas-runtime/src/index.ts`:

```ts
export * from "./types.js";
export * from "./persona-filter.js";
export * from "./registry.js";
export * from "./events.js";
```

- [ ] **Step 6: Build + typecheck the package**

```bash
pnpm --filter @atlas/canvas-runtime build
pnpm --filter @atlas/canvas-runtime typecheck
```

Both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/canvas-runtime/src/events.ts packages/canvas-runtime/src/index.ts packages/canvas-runtime/test/events.test.ts
git commit -m "feat(canvas-runtime): CanvasEventSchema + index exports"
```

---

### Task 6: Extend `RitualEventSchema` discriminated union with canvas events

**Files:**
- Modify: `packages/ritual-engine/src/events.ts`
- Modify: `packages/ritual-engine/package.json` (add `@atlas/canvas-runtime` workspace dep)
- Create: `packages/ritual-engine/test/events-canvas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ritual-engine/test/events-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RitualEventSchema } from "../src/events.js";

describe("RitualEventSchema (canvas events)", () => {
  it("accepts architect.canvas_manifest.emitted", () => {
    const ev = RitualEventSchema.parse({
      type: "architect.canvas_manifest.emitted",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: {
        manifest: {
          artifactKind: "frontend-app",
          modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
        }
      }
    });
    expect(ev.type).toBe("architect.canvas_manifest.emitted");
  });

  it("accepts canvas.options.requested", () => {
    const ev = RitualEventSchema.parse({
      type: "canvas.options.requested",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: {
        proposal: { recommended: { id: "x" } },
        manifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["ama"] }] }
      }
    });
    expect(ev.type).toBe("canvas.options.requested");
  });

  it("accepts canvas.option.selected", () => {
    const ev = RitualEventSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: { directionId: "editorial-dark", tokens: {}, autoSelected: false }
    });
    expect(ev.type).toBe("canvas.option.selected");
  });
});
```

- [ ] **Step 2: Add workspace dep**

In `packages/ritual-engine/package.json`, add to `dependencies`:

```json
"@atlas/canvas-runtime": "workspace:*",
```

Run `pnpm install` from repo root. Wait — there's a circular-dep risk: canvas-runtime imports from ritual-engine (PersonaTierSchema). Resolve by importing ONLY the canvas event schemas back into ritual-engine, not the full barrel. Since canvas-runtime depends on ritual-engine for `PersonaTierSchema`, and ritual-engine imports specific files (not the `@atlas/canvas-runtime` barrel during build), the cycle is only via `dependencies` in package.json. pnpm handles this for workspace deps; tsc with `composite: true` requires careful project references. Verify with build:

```bash
pnpm --filter @atlas/ritual-engine build
```

If this errors with TS6306 ("Referenced project must have setting composite") add canvas-runtime to ritual-engine's `tsconfig.json` `references` array.

- [ ] **Step 3: Run failing test**

```bash
pnpm --filter @atlas/ritual-engine test test/events-canvas.test.ts
```

Expected: FAIL — `Invalid discriminator value` for the new types.

- [ ] **Step 4: Modify `events.ts`**

In `packages/ritual-engine/src/events.ts`, import from canvas-runtime and extend the union:

```ts
import {
  ArchitectCanvasManifestEmittedSchema,
  ResearcherBriefCompletedSchema,
  ResearcherBriefFailedSchema,
  DesignerProposalEmittedSchema,
  DesignerProposalFailedSchema,
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema
} from "@atlas/canvas-runtime";
```

And in the existing `z.discriminatedUnion("type", [ ... ])`, append the nine new schemas.

- [ ] **Step 5: Run — expect green**

```bash
pnpm --filter @atlas/ritual-engine test test/events-canvas.test.ts
```

Expected: PASS — 3 cases.

- [ ] **Step 6: Run the full ritual-engine suite**

```bash
pnpm --filter @atlas/ritual-engine test
```

Expected: every existing test still PASS (extending a discriminated union is additive).

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/package.json packages/ritual-engine/src/events.ts packages/ritual-engine/test/events-canvas.test.ts
git commit -m "feat(ritual-engine): extend RitualEventSchema with canvas + researcher + designer events"
```

---

### Task 7: `canvas-pause.ts` — engine pause primitive with timeout-and-auto-select

**Files:**
- Create: `packages/ritual-engine/src/canvas-pause.ts`
- Create: `packages/ritual-engine/test/canvas-pause.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ritual-engine/test/canvas-pause.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CanvasPauseRegistry } from "../src/canvas-pause.js";

describe("CanvasPauseRegistry", () => {
  it("waitForOption resolves when resolveOption is called", async () => {
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: { palette: {} } }
    });
    setTimeout(() => reg.resolveOption("r-1", { directionId: "selected", tokens: { palette: { primary: "#000" } } }), 5);
    const result = await promise;
    expect(result.autoSelected).toBe(false);
    expect(result.directionId).toBe("selected");
  });

  it("times out → resolves with recommended + autoSelected=true", async () => {
    vi.useFakeTimers();
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 100,
      recommendedFallback: { directionId: "rec", tokens: { palette: {} } }
    });
    vi.advanceTimersByTime(150);
    const result = await promise;
    expect(result.autoSelected).toBe(true);
    expect(result.directionId).toBe("rec");
    vi.useRealTimers();
  });

  it("resolveOption with no waiter is a no-op (no throw)", () => {
    const reg = new CanvasPauseRegistry();
    expect(() => reg.resolveOption("r-1", { directionId: "x", tokens: {} })).not.toThrow();
  });

  it("double-resolve is safe (second resolve is no-op)", async () => {
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: {} }
    });
    reg.resolveOption("r-1", { directionId: "first", tokens: {} });
    reg.resolveOption("r-1", { directionId: "second", tokens: {} });
    const r = await promise;
    expect(r.directionId).toBe("first");
  });

  it("dispose clears pending waiter without resolving", () => {
    const reg = new CanvasPauseRegistry();
    void reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: {} }
    });
    expect(reg.pendingCount()).toBe(1);
    reg.dispose("r-1");
    expect(reg.pendingCount()).toBe(0);
  });

  it("multiple waiters for distinct ritualIds resolve independently", async () => {
    const reg = new CanvasPauseRegistry();
    const p1 = reg.waitForOption({ ritualId: "r-1", timeoutMs: 1000, recommendedFallback: { directionId: "a", tokens: {} } });
    const p2 = reg.waitForOption({ ritualId: "r-2", timeoutMs: 1000, recommendedFallback: { directionId: "b", tokens: {} } });
    reg.resolveOption("r-2", { directionId: "B-real", tokens: {} });
    reg.resolveOption("r-1", { directionId: "A-real", tokens: {} });
    expect((await p1).directionId).toBe("A-real");
    expect((await p2).directionId).toBe("B-real");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/ritual-engine test test/canvas-pause.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/ritual-engine/src/canvas-pause.ts`:

```ts
export interface CanvasOptionResolution {
  directionId: string;
  tokens: unknown;
  autoSelected: boolean;
}

interface RecommendedFallback {
  directionId: string;
  tokens: unknown;
}

interface WaitForOptionInput {
  ritualId: string;
  timeoutMs: number;
  recommendedFallback: RecommendedFallback;
}

interface PendingWaiter {
  resolve: (r: CanvasOptionResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Engine-side promise registry. _runRitual awaits waitForOption; a Server
 *  Action's selectDesignDirection call invokes resolveOption on the same
 *  per-request engine instance. Timeout (default 30 min) auto-resolves with
 *  the architect/designer's recommended direction. */
export class CanvasPauseRegistry {
  private readonly waiters = new Map<string, PendingWaiter>();

  waitForOption(input: WaitForOptionInput): Promise<CanvasOptionResolution> {
    return new Promise<CanvasOptionResolution>((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiters.delete(input.ritualId)) {
          resolve({
            directionId: input.recommendedFallback.directionId,
            tokens: input.recommendedFallback.tokens,
            autoSelected: true
          });
        }
      }, input.timeoutMs);
      this.waiters.set(input.ritualId, { resolve, timer });
    });
  }

  /** Idempotent: second call for the same ritualId is a no-op so a stale
   *  Server-Action retry can't double-resolve. */
  resolveOption(ritualId: string, payload: { directionId: string; tokens: unknown }): void {
    const w = this.waiters.get(ritualId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
    w.resolve({ directionId: payload.directionId, tokens: payload.tokens, autoSelected: false });
  }

  dispose(ritualId: string): void {
    const w = this.waiters.get(ritualId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
  }

  pendingCount(): number {
    return this.waiters.size;
  }
}

/** Default 30-minute pause window per spec ("user never clicks → engine auto-selects"). */
export const DEFAULT_CANVAS_PAUSE_TIMEOUT_MS = 30 * 60 * 1000;
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/ritual-engine test test/canvas-pause.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Re-export from index**

Edit `packages/ritual-engine/src/index.ts` — append:

```ts
export {
  CanvasPauseRegistry,
  DEFAULT_CANVAS_PAUSE_TIMEOUT_MS,
  type CanvasOptionResolution
} from "./canvas-pause.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/canvas-pause.ts packages/ritual-engine/src/index.ts packages/ritual-engine/test/canvas-pause.test.ts
git commit -m "feat(ritual-engine): CanvasPauseRegistry — waitForOption + resolveOption + 30-min timeout"
```

---

### Task 8: Engine integration — Researcher → Designer dispatch + canvas pause + selectedTokens fold

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Create: `packages/ritual-engine/test/engine-canvas-flow.test.ts`
- Create: `packages/ritual-engine/test/engine-canvas-flag-off.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/ritual-engine/test/engine-canvas-flow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry, InMemoryEventSink } from "../src/index.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

function makeRole(roleId: string, events: Array<{ eventType: string; payload: unknown }>): Role {
  return {
    id: roleId,
    async run() {
      return {
        roleId,
        output: {
          events,
          diff: { kind: "no-op" } as never
        }
      } as never;
    }
  } as unknown as Role;
}

describe("Engine canvas flow (architect → researcher → designer → pause → developer)", () => {
  it("dispatches Researcher then Designer; pauses; resumes after resolveOption; passes selectedTokens to developer", async () => {
    const sink = new InMemoryEventSink();
    const pauseRegistry = new CanvasPauseRegistry();

    const architectArtifact = {
      scope: "new-app",
      specGraph: {},
      runnablePlan: { tasks: [] },
      designIntent: { category: "restaurant-landing", audienceCues: ["premium"] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
        ]
      },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    };

    const architect = makeRole("architect", [
      { eventType: "architect.pass2.completed", payload: { artifact: architectArtifact } }
    ]);
    const researcher = makeRole("researcher", [
      { eventType: "researcher.brief.completed", payload: { sourceTier: "local-only", referenceCount: 2 } }
    ]);
    const designer = makeRole("designer", [
      {
        eventType: "designer.proposal.emitted",
        payload: {
          recommendedId: "editorial-dark",
          alternateIds: ["minimal-warm", "premium-serif"],
          proposal: {
            recommended: { id: "editorial-dark", tokens: { palette: { primary: "#000" } } },
            alternates: [
              { id: "minimal-warm", tokens: { palette: { primary: "#fff" } } },
              { id: "premium-serif", tokens: { palette: { primary: "#888" } } }
            ]
          }
        }
      }
    ]);

    const developerRunSpy = vi.fn();
    const developer: Role = {
      id: "developer",
      async run(_ctx, opts: { priorArtifact?: unknown }) {
        developerRunSpy(opts.priorArtifact);
        return {
          roleId: "developer",
          output: { events: [{ eventType: "developer.completed", payload: { summary: "ok" } }], diff: { kind: "patch", body: "diff --git a/x" } }
        } as never;
      }
    } as unknown as Role;

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architect],
        ["researcher", researcher],
        ["designer", designer],
        ["developer", developer]
      ]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const engine = new RitualEngine({
      conductor,
      eventSink: sink,
      personaPreferences: personaPrefs,
      canvasFlowEnabled: true,
      canvasPauseRegistry: pauseRegistry,
      canvasPauseTimeoutMs: 60_000
    });

    // Resolve the pause asynchronously to simulate a user clicking "Use this →".
    setTimeout(() => {
      pauseRegistry.resolveOption("r-test", {
        directionId: "editorial-dark",
        tokens: { palette: { primary: "#0a0a0a", accent: "#fbbf24" } }
      });
    }, 10);

    const ritualId = await engine.start({
      userTurn: "build me a premium restaurant landing page",
      editClass: "structural",
      projectId: "p-1",
      userId: "u-1"
    });

    // Engine emitted canvas events
    const events = sink.events();
    expect(events.some((e) => e.type === "architect.canvas_manifest.emitted")).toBe(true);
    expect(events.some((e) => e.type === "canvas.options.requested")).toBe(true);
    expect(events.some((e) => e.type === "canvas.option.selected")).toBe(true);

    // Developer received the merged priorArtifact (architect output + selectedTokens)
    expect(developerRunSpy).toHaveBeenCalledOnce();
    const priorArtifact = developerRunSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(priorArtifact.selectedTokens).toBeDefined();
    expect((priorArtifact.selectedTokens as { palette: { accent: string } }).palette.accent).toBe("#fbbf24");

    // Note: real ritualId is randomized; the test uses "r-test" as the resolveOption key so the test
    // helper must align IDs OR the engine must accept an id-injection seam. See implementation step.
    expect(ritualId).toBeTruthy();
  });
});
```

> Note on id-injection: the real `_runRitual` generates `r-${randomUUID()}`. The test above hardcodes "r-test"; resolve by either (a) seeding the engine with `idGenerator: () => "r-test"` option for tests, or (b) reading the ritualId from the `ritual.started` event before calling `resolveOption`. Pick (b) to avoid shimming production code:

Update test setup:

```ts
const startPromise = engine.start({ ... });
// Wait one microtask for ritual.started to land in the sink
await new Promise((r) => setImmediate(r));
const startedEvent = sink.events().find((e) => e.type === "ritual.started");
const ritualId = startedEvent!.ritualId;
setTimeout(() => pauseRegistry.resolveOption(ritualId, { directionId: "editorial-dark", tokens: { ... } }), 10);
const finalRitualId = await startPromise;
```

- [ ] **Step 2: Write the flag-OFF lock test**

Create `packages/ritual-engine/test/engine-canvas-flag-off.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, InMemoryEventSink } from "../src/index.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

describe("Engine canvas flow (flag OFF)", () => {
  it("does NOT dispatch researcher or designer when canvasFlowEnabled is false", async () => {
    const sink = new InMemoryEventSink();
    const researcherRun = vi.fn();
    const designerRun = vi.fn();

    const architect: Role = {
      id: "architect",
      async run() {
        return {
          roleId: "architect",
          output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } } } }], diff: { kind: "no-op" } }
        } as never;
      }
    } as unknown as Role;
    const researcher: Role = { id: "researcher", async run() { researcherRun(); return null as never; } } as never;
    const designer: Role = { id: "designer", async run() { designerRun(); return null as never; } } as never;
    const developer: Role = {
      id: "developer",
      async run() {
        return {
          roleId: "developer",
          output: { events: [{ eventType: "developer.completed", payload: { summary: "ok" } }], diff: { kind: "no-op" } }
        } as never;
      }
    } as never;

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architect],
        ["researcher", researcher],
        ["designer", designer],
        ["developer", developer]
      ]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const engine = new RitualEngine({ conductor, eventSink: sink, personaPreferences: personaPrefs });
    // canvasFlowEnabled defaults to false; no canvasPauseRegistry passed.

    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });

    expect(researcherRun).not.toHaveBeenCalled();
    expect(designerRun).not.toHaveBeenCalled();
    expect(sink.events().some((e) => e.type === "canvas.options.requested")).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect failure (engine has no canvas wiring yet)**

```bash
pnpm --filter @atlas/ritual-engine test test/engine-canvas-flow.test.ts test/engine-canvas-flag-off.test.ts
```

- [ ] **Step 4: Implement engine wiring**

In `packages/ritual-engine/src/engine.ts`:

A. Extend `RitualEngineOptions`:

```ts
  /** Plan S.4: when true AND the architect's artifact carries a canvasManifest
   *  with a design-blocking mode, the engine dispatches Researcher → Designer →
   *  emits canvas.options.requested → awaits canvasPauseRegistry.waitForOption →
   *  resumes Developer with selectedTokens folded into priorArtifact.
   *  Researcher / Designer dispatch is skipped if their roles aren't registered
   *  (sub-flag composition). Default false preserves today's behavior. */
  canvasFlowEnabled?: boolean;
  canvasPauseRegistry?: CanvasPauseRegistry;
  canvasPauseTimeoutMs?: number;
  /** "fast" mode (RitualOptions per spec) skips Researcher; default "considered". */
  ritualMode?: "fast" | "considered";
```

B. Add to constructor + private fields:

```ts
private readonly canvasFlowEnabled: boolean;
private readonly canvasPauseRegistry?: CanvasPauseRegistry;
private readonly canvasPauseTimeoutMs: number;
private readonly ritualMode: "fast" | "considered";
// in constructor:
this.canvasFlowEnabled = opts.canvasFlowEnabled ?? false;
this.canvasPauseRegistry = opts.canvasPauseRegistry;
this.canvasPauseTimeoutMs = opts.canvasPauseTimeoutMs ?? DEFAULT_CANVAS_PAUSE_TIMEOUT_MS;
this.ritualMode = opts.ritualMode ?? "considered";
```

C. Insert canvas dispatch block after `record.roleEvents = result.output.events.map(...)` and BEFORE the existing developer dispatch (`if (artifact && input.editClass !== "cosmetic")`):

```ts
let selectedTokens: unknown | undefined;
if (this.canvasFlowEnabled && artifact && input.editClass !== "cosmetic") {
  const manifest = (artifact as { canvasManifest?: unknown }).canvasManifest;
  const designIntent = (artifact as { designIntent?: unknown }).designIntent;
  const parsed = manifest ? CanvasManifestSchema.safeParse(manifest) : null;
  const hasBlockingDesign = parsed?.success && parsed.data.modes.some((m) => m.blockingFor === "design");

  if (parsed?.success) {
    await this.emit({
      type: "architect.canvas_manifest.emitted",
      ritualId, ts: new Date().toISOString(),
      payload: { manifest: parsed.data }
    });
  }

  if (hasBlockingDesign) {
    // Researcher (skipped in fast mode OR if role unregistered)
    let brief: unknown | undefined;
    if (this.ritualMode !== "fast") {
      try {
        const r = await this.conductor.dispatch(
          { ritualId: ritualId as never, graphVersion: 0, userTurn: input.userTurn, projectId: input.projectId },
          { forceRoleId: "researcher", priorArtifact: { designIntent } }
        );
        record.roleEvents = [...(record.roleEvents ?? []), ...r.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))];
        const completed = r.output.events.find((e) => e.eventType === "researcher.brief.completed");
        brief = (completed?.payload as { brief?: unknown } | undefined)?.brief;
      } catch (err) {
        record.roleEvents = [...(record.roleEvents ?? []), { eventType: "researcher.dispatch.failed", payload: { error: err instanceof Error ? err.message : String(err) } }];
      }
    }

    // Designer (always when canvas flow on; runs with empty brief if researcher skipped/failed)
    let proposal: { recommended: { id: string; tokens: unknown }; alternates: unknown } | undefined;
    try {
      const d = await this.conductor.dispatch(
        { ritualId: ritualId as never, graphVersion: 0, userTurn: input.userTurn, projectId: input.projectId },
        { forceRoleId: "designer", priorArtifact: { artifact, brief, designIntent } }
      );
      record.roleEvents = [...(record.roleEvents ?? []), ...d.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))];
      const ev = d.output.events.find((e) => e.eventType === "designer.proposal.emitted");
      proposal = (ev?.payload as { proposal?: typeof proposal } | undefined)?.proposal;
    } catch (err) {
      record.roleEvents = [...(record.roleEvents ?? []), { eventType: "designer.dispatch.failed", payload: { error: err instanceof Error ? err.message : String(err) } }];
    }

    // Pause + emit canvas.options.requested + await selection
    if (proposal && this.canvasPauseRegistry) {
      await this.emit({
        type: "canvas.options.requested",
        ritualId, ts: new Date().toISOString(),
        payload: { proposal, manifest: parsed!.data }
      });
      const resolution = await this.canvasPauseRegistry.waitForOption({
        ritualId,
        timeoutMs: this.canvasPauseTimeoutMs,
        recommendedFallback: { directionId: proposal.recommended.id, tokens: proposal.recommended.tokens }
      });
      selectedTokens = resolution.tokens;
      await this.emit({
        type: "canvas.option.selected",
        ritualId, ts: new Date().toISOString(),
        payload: { directionId: resolution.directionId, tokens: resolution.tokens, autoSelected: resolution.autoSelected }
      });
    }
  }
}

// Fold selectedTokens into the artifact passed to developer
const developerPriorArtifact = selectedTokens ? { ...(artifact as object), selectedTokens } : artifact;
```

Then update the existing developer dispatch line:

```ts
{ forceRoleId: "developer", priorArtifact: developerPriorArtifact }
```

Add the import at the top:

```ts
import { CanvasManifestSchema } from "@atlas/canvas-runtime";
import { CanvasPauseRegistry, DEFAULT_CANVAS_PAUSE_TIMEOUT_MS } from "./canvas-pause.js";
```

- [ ] **Step 5: Run — expect green**

```bash
pnpm --filter @atlas/ritual-engine test test/engine-canvas-flow.test.ts test/engine-canvas-flag-off.test.ts
```

Expected: PASS — both tests.

- [ ] **Step 6: Run full ritual-engine suite (no regressions)**

```bash
pnpm --filter @atlas/ritual-engine test
```

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-canvas-flow.test.ts packages/ritual-engine/test/engine-canvas-flag-off.test.ts
git commit -m "feat(ritual-engine): canvas flow — researcher → designer → pause → developer with selectedTokens"
```

---

### Task 9: Hydrator extension — fold canvas events into snapshot

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/src/engine.ts` (add `selectedTokens` field to `RitualSnapshot` + `RitualRecord`)
- Create: `packages/ritual-engine/test/hydrator-canvas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ritual-engine/test/hydrator-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { replayEventsToSnapshot } from "../src/hydrator.js";

describe("hydrator (canvas events)", () => {
  it("populates selectedTokens from canvas.option.selected", () => {
    const snap = replayEventsToSnapshot([
      { id: 1n, eventType: "ritual.started", payload: { projectId: "p", userId: "u", intent: "x", editClass: "structural" }, actor: null },
      { id: 2n, eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-app" } }, actor: null },
      { id: 3n, eventType: "designer.proposal.emitted", payload: { recommendedId: "x", alternateIds: ["a", "b"] }, actor: null },
      { id: 4n, eventType: "canvas.option.selected", payload: { directionId: "x", tokens: { palette: { primary: "#000" } }, autoSelected: false }, actor: null }
    ]);
    expect(snap).not.toBeNull();
    expect(snap!.selectedTokens).toEqual({ palette: { primary: "#000" } });
    // canvas events also captured in roleEvents for diagnostic UIs
    expect(snap!.roleEvents.some((e) => e.eventType === "canvas.option.selected")).toBe(true);
  });

  it("captures the manifest from architect.canvas_manifest.emitted", () => {
    const snap = replayEventsToSnapshot([
      { id: 1n, eventType: "ritual.started", payload: { projectId: "p", userId: "u", intent: "x", editClass: "structural" }, actor: null },
      { id: 2n, eventType: "architect.canvas_manifest.emitted", payload: { manifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["ama"] }] } }, actor: null }
    ]);
    expect(snap!.canvasManifest).toBeDefined();
    expect((snap!.canvasManifest as { artifactKind: string }).artifactKind).toBe("frontend-app");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/ritual-engine test test/hydrator-canvas.test.ts
```

- [ ] **Step 3: Add `selectedTokens` + `canvasManifest` to `RitualSnapshot` + `RitualRecord`**

In `engine.ts`, extend both interfaces:

```ts
// in RitualRecord
selectedTokens?: unknown;
canvasManifest?: unknown;

// in RitualSnapshot
selectedTokens?: unknown;
canvasManifest?: unknown;

// in getRitual return — add the two fields
```

Also persist into `record` from the canvas dispatch block (Task 8) — append:

```ts
record.canvasManifest = parsed.data;
// after pause resolves:
record.selectedTokens = selectedTokens;
```

- [ ] **Step 4: Modify `hydrator.ts` `applyOne`**

Add to the existing if/else chain in `applyOne`:

```ts
} else if (t === "architect.canvas_manifest.emitted" && p && "manifest" in p) {
  snap.canvasManifest = p.manifest;
} else if (t === "canvas.option.selected" && p && "tokens" in p) {
  snap.selectedTokens = p.tokens;
}
```

And extend the role-event capture filter at the bottom:

```ts
t.startsWith("canvas.") ||
t.startsWith("researcher.") ||
t.startsWith("designer.") ||
```

- [ ] **Step 5: Run — expect green**

```bash
pnpm --filter @atlas/ritual-engine test test/hydrator-canvas.test.ts
pnpm --filter @atlas/ritual-engine test
```

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/src/engine.ts packages/ritual-engine/test/hydrator-canvas.test.ts
git commit -m "feat(ritual-engine): hydrator folds canvas.option.selected + canvas_manifest.emitted into snapshot"
```

---

### Task 10: Architect — extend `ArchitectOutput` with `designIntent` + `canvasManifest` fields

**Files:**
- Modify: `packages/role-architect/src/types.ts`
- Modify: `packages/role-architect/package.json` (add `@atlas/canvas-runtime` workspace dep)
- Create: `packages/role-architect/test/types-canvas-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-architect/test/types-canvas-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ArchitectOutputSchema } from "../src/types.js";

const baseSlice = { bytes: "{}", hash: "sha256:" + "0".repeat(64) };

describe("ArchitectOutput (canvas fields)", () => {
  it("new-app accepts designIntent + canvasManifest", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "new-app",
      specGraph: {},
      runnablePlan: { tasks: [] },
      graphSlice: baseSlice,
      designIntent: { category: "restaurant-landing", audienceCues: ["premium"] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
      }
    });
    expect((ok as { canvasManifest: { artifactKind: string } }).canvasManifest.artifactKind).toBe("frontend-app");
  });

  it("new-app accepts undefined canvas fields (back-compat)", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: baseSlice
    });
    expect((ok as { canvasManifest?: unknown }).canvasManifest).toBeUndefined();
  });

  it("rejects malformed canvasManifest", () => {
    expect(() =>
      ArchitectOutputSchema.parse({
        scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: baseSlice,
        canvasManifest: { artifactKind: "not-a-real-kind", modes: [] }
      })
    ).toThrow();
  });

  it("refactor scope also accepts canvas fields (no-op for that scope)", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "refactor",
      beforeAfterGraph: { before: {}, after: {} },
      behaviorPreservationContract: [],
      regressionTests: [],
      graphSlice: baseSlice
    });
    expect(ok.scope).toBe("refactor");
  });
});
```

- [ ] **Step 2: Add workspace dep**

In `packages/role-architect/package.json`, add to `dependencies`:

```json
"@atlas/canvas-runtime": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 3: Modify `types.ts`**

In `packages/role-architect/src/types.ts`, import and add optional fields to each scope variant:

```ts
import { CanvasManifestSchema } from "@atlas/canvas-runtime";

const DesignIntentEmbeddedSchema = z.object({
  category: z.string().min(1),
  audienceCues: z.array(z.string())
});

// Then on each scope schema, add:
//   designIntent: DesignIntentEmbeddedSchema.optional(),
//   canvasManifest: CanvasManifestSchema.optional()
```

Apply to all 7 scope variants (NewAppOutputSchema, NewFeatureOutputSchema, BugFixOutputSchema, DepUpgradeOutputSchema, RefactorOutputSchema, ShipOutputSchema, MigrateOutputSchema).

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-architect test test/types-canvas-fields.test.ts
pnpm --filter @atlas/role-architect test
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/package.json packages/role-architect/src/types.ts packages/role-architect/test/types-canvas-fields.test.ts
git commit -m "feat(role-architect): ArchitectOutput accepts designIntent + canvasManifest (per-scope optional)"
```

---

### Task 11: Architect — synthesize `canvasManifest` from artifactKind in `enrichArchitectOutput`

**Files:**
- Modify: `packages/role-architect/src/deep-plan.ts`
- Create: `packages/role-architect/test/deep-plan-canvas-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-architect/test/deep-plan-canvas-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ArchitectOutputSchema } from "../src/types.js";
// We test the helper directly. Export it from deep-plan.ts for testing.
import { synthesizeCanvasManifest } from "../src/deep-plan.js";

describe("synthesizeCanvasManifest", () => {
  it("new-app → frontend-app manifest with designing default+blocking + preview", () => {
    const m = synthesizeCanvasManifest("new-app", { specGraph: { kind: "frontend-app" } });
    expect(m).toBeDefined();
    expect(m!.artifactKind).toBe("frontend-app");
    expect(m!.modes.find((mm) => mm.id === "designing")?.blockingFor).toBe("design");
    expect(m!.modes.map((mm) => mm.id).sort()).toEqual(["designing", "preview"]);
  });

  it("new-app with backend-rest-api specGraph → schema manifest", () => {
    const m = synthesizeCanvasManifest("new-app", { specGraph: { kind: "backend-rest-api" } });
    expect(m!.artifactKind).toBe("backend-rest-api");
    expect(m!.modes.some((mm) => mm.id === "schema")).toBe(true);
  });

  it("refactor → no manifest (returns undefined)", () => {
    const m = synthesizeCanvasManifest("refactor", {});
    expect(m).toBeUndefined();
  });

  it("ship → no manifest (returns undefined)", () => {
    const m = synthesizeCanvasManifest("ship", {});
    expect(m).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-architect test test/deep-plan-canvas-manifest.test.ts
```

- [ ] **Step 3: Modify `deep-plan.ts`**

Add helper + integrate into `enrichArchitectOutput`:

```ts
import { defaultManifestForArtifactKind, type ArtifactKind, type CanvasManifest } from "@atlas/canvas-runtime";

/** Synthesize a CanvasManifest from the architect's scope + artifact. Returns
 *  undefined when the scope is not user-facing (refactor, ship, migrate). */
export function synthesizeCanvasManifest(scope: string, model: Record<string, unknown>): CanvasManifest | undefined {
  if (!["new-app", "new-feature"].includes(scope)) return undefined;
  const specGraph = model.specGraph as { kind?: string } | undefined;
  const kind = specGraph?.kind ?? "frontend-app";
  const valid: ArtifactKind[] = ["frontend-app", "backend-rest-api", "backend-graphql", "data-pipeline", "mobile-app", "cli-tool"];
  if (!valid.includes(kind as ArtifactKind)) return undefined;
  return defaultManifestForArtifactKind(kind as ArtifactKind);
}
```

In `enrichArchitectOutput`, add manifest synthesis if model didn't supply one:

```ts
function enrichArchitectOutput(
  raw: unknown,
  graphSlice: { bytes: string; hash: string },
  scope: string
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = raw as Record<string, unknown>;
  const defaults = scopeDefaults(scope);
  const merged = { ...defaults, ...model, scope, graphSlice };
  if (!("canvasManifest" in model)) {
    const manifest = synthesizeCanvasManifest(scope, merged);
    if (manifest) (merged as Record<string, unknown>).canvasManifest = manifest;
  }
  return merged;
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-architect test test/deep-plan-canvas-manifest.test.ts
pnpm --filter @atlas/role-architect test
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/deep-plan.ts packages/role-architect/test/deep-plan-canvas-manifest.test.ts
git commit -m "feat(role-architect): synthesizeCanvasManifest folds default modes per artifactKind into enrichArchitectOutput"
```

---

### Task 12: atlas-web — register `canvas-v1` feature flag

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Create: `apps/atlas-web/test/lib/feature-flags-canvas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/feature-flags-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isFeatureEnabled, listFlagStates, type FeatureFlagSource } from "@/lib/feature-flags";

describe("canvas-v1 feature flag", () => {
  it("returns false when ATLAS_FF_CANVAS_V1 is unset", () => {
    const src: FeatureFlagSource = { readEnv: () => undefined };
    expect(isFeatureEnabled("canvas-v1", src)).toBe(false);
  });

  it("returns true when ATLAS_FF_CANVAS_V1=true", () => {
    const src: FeatureFlagSource = { readEnv: (n) => (n === "ATLAS_FF_CANVAS_V1" ? "true" : undefined) };
    expect(isFeatureEnabled("canvas-v1", src)).toBe(true);
  });

  it("listFlagStates includes canvas-v1", () => {
    const src: FeatureFlagSource = { readEnv: () => undefined };
    expect("canvas-v1" in listFlagStates(src)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure (flag not yet registered)**

```bash
pnpm --filter atlas-web vitest run test/lib/feature-flags-canvas.test.ts
```

- [ ] **Step 3: Modify `feature-flags.ts`**

Add to `FeatureFlag` union: `| "canvas-v1"`.
Add to `FLAG_TO_ENV`: `"canvas-v1": "ATLAS_FF_CANVAS_V1"`.
Add to `listFlagStates` return: `"canvas-v1": isFeatureEnabled("canvas-v1", source)`.

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter atlas-web vitest run test/lib/feature-flags-canvas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags-canvas.test.ts
git commit -m "feat(atlas-web): register canvas-v1 feature flag (ATLAS_FF_CANVAS_V1)"
```

---

### Task 13: atlas-web — `EventBroker` extends `RitualEventType` with canvas events

**Files:**
- Modify: `apps/atlas-web/lib/events/EventBroker.ts`
- Create: `apps/atlas-web/test/lib/events/EventBroker-canvas.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/atlas-web/test/lib/events/EventBroker-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { RitualEventType } from "@/lib/events/EventBroker";

describe("RitualEventType (canvas events)", () => {
  it("includes the canvas + designer + researcher event types", () => {
    const required: RitualEventType[] = [
      "architect.canvas_manifest.emitted",
      "researcher.brief.completed",
      "designer.proposal.emitted",
      "canvas.options.requested",
      "canvas.option.selected",
      "canvas.refinement.started",
      "canvas.refinement.completed"
    ];
    // Compile-time check; runtime sanity:
    expect(required.length).toBe(7);
  });
});
```

- [ ] **Step 2: Run — expect TS compile failure (types missing)**

```bash
pnpm --filter atlas-web typecheck
```

- [ ] **Step 3: Modify `EventBroker.ts`**

Locate the `RitualEventType` union, append the 7 string-literal types listed above. Update any switch-on-type code paths to handle them as no-op (the broker just forwards).

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter atlas-web vitest run test/lib/events/EventBroker-canvas.test.ts
pnpm --filter atlas-web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/test/lib/events/EventBroker-canvas.test.ts
git commit -m "feat(atlas-web): extend RitualEventType with canvas + researcher + designer events"
```

---

### Task 14: atlas-web — `<EmptyCanvas>` placeholder component

**Files:**
- Create: `apps/atlas-web/components/canvas/EmptyCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/EmptyCanvas.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/atlas-web/test/components/canvas/EmptyCanvas.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyCanvas } from "@/components/canvas/EmptyCanvas";

describe("<EmptyCanvas>", () => {
  it("renders a status region with helpful copy", () => {
    render(<EmptyCanvas />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/start a ritual/i)).toBeInTheDocument();
  });

  it("has a stable test id for downstream automation", () => {
    render(<EmptyCanvas />);
    expect(screen.getByTestId("canvas-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
export function EmptyCanvas() {
  return (
    <div
      role="status"
      data-testid="canvas-empty"
      className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-500"
    >
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-slate-700">Canvas waiting</p>
        <p className="mt-1 text-xs text-slate-500">Start a ritual on the left to populate the canvas.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run — expect green; commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/EmptyCanvas.test.tsx
git add apps/atlas-web/components/canvas/EmptyCanvas.tsx apps/atlas-web/test/components/canvas/EmptyCanvas.test.tsx
git commit -m "feat(atlas-web/canvas): EmptyCanvas placeholder for pre-ritual state"
```

---

### Task 15: atlas-web — `<ModeToggle>` segmented control

**Files:**
- Create: `apps/atlas-web/components/canvas/ModeToggle.tsx`
- Create: `apps/atlas-web/test/components/canvas/ModeToggle.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToggle } from "@/components/canvas/ModeToggle";

describe("<ModeToggle>", () => {
  const modes = [
    { id: "designing", renderer: "designing", audience: ["ama" as const] },
    { id: "preview", renderer: "preview", audience: ["ama" as const] }
  ];

  it("renders a button per mode", () => {
    render(<ModeToggle modes={modes} activeId="designing" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /designing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
  });

  it("marks the active mode with aria-pressed=true", () => {
    render(<ModeToggle modes={modes} activeId="designing" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /designing/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /preview/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a mode fires onSelect with its id", () => {
    const onSelect = vi.fn();
    render(<ModeToggle modes={modes} activeId="designing" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(onSelect).toHaveBeenCalledWith("preview");
  });

  it("renders nothing when modes is empty", () => {
    const { container } = render(<ModeToggle modes={[]} activeId="" onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import type { CanvasMode } from "@atlas/canvas-runtime";

export interface ModeToggleProps {
  modes: CanvasMode[];
  activeId: string;
  onSelect: (id: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  designing: "Designing", preview: "Preview", schema: "Schema", endpoints: "Endpoints", logs: "Logs"
};

export function ModeToggle({ modes, activeId, onSelect }: ModeToggleProps) {
  if (modes.length === 0) return null;
  return (
    <div role="tablist" aria-label="Canvas mode" className="inline-flex rounded-md border border-slate-200 bg-white p-1 text-sm">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={m.id === activeId}
          onClick={() => onSelect(m.id)}
          className={
            m.id === activeId
              ? "rounded px-3 py-1 bg-slate-900 text-white"
              : "rounded px-3 py-1 text-slate-700 hover:bg-slate-100"
          }
        >
          {MODE_LABELS[m.id] ?? m.id}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/ModeToggle.test.tsx
git add apps/atlas-web/components/canvas/ModeToggle.tsx apps/atlas-web/test/components/canvas/ModeToggle.test.tsx
git commit -m "feat(atlas-web/canvas): ModeToggle segmented control"
```

---

### Task 16: atlas-web — `use-canvas-state` hook (auto-switch + sticky override)

**Files:**
- Create: `apps/atlas-web/lib/canvas/use-canvas-state.ts`
- Create: `apps/atlas-web/test/lib/canvas/use-canvas-state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasState } from "@/lib/canvas/use-canvas-state";

const MANIFEST = {
  artifactKind: "frontend-app" as const,
  modes: [
    { id: "designing", renderer: "designing", audience: ["ama"] as const, default: true },
    { id: "preview", renderer: "preview", audience: ["ama"] as const }
  ]
};

describe("useCanvasState", () => {
  it("initial activeId is the manifest's default mode", () => {
    const { result } = renderHook(() => useCanvasState({ manifest: MANIFEST, ritualId: "r-1" }));
    expect(result.current.activeId).toBe("designing");
  });

  it("auto-switches to event-suggested mode when no manual override", () => {
    const { result } = renderHook(() => useCanvasState({ manifest: MANIFEST, ritualId: "r-1" }));
    act(() => result.current.suggestMode("preview"));
    expect(result.current.activeId).toBe("preview");
  });

  it("manual override stays sticky against later suggestMode calls (same ritual)", () => {
    const { result } = renderHook(() => useCanvasState({ manifest: MANIFEST, ritualId: "r-1" }));
    act(() => result.current.setMode("preview"));
    act(() => result.current.suggestMode("designing"));
    expect(result.current.activeId).toBe("preview");
  });

  it("sticky override clears when ritualId changes", () => {
    const { result, rerender } = renderHook(
      ({ ritualId }: { ritualId: string }) => useCanvasState({ manifest: MANIFEST, ritualId }),
      { initialProps: { ritualId: "r-1" } }
    );
    act(() => result.current.setMode("preview"));
    rerender({ ritualId: "r-2" });
    act(() => result.current.suggestMode("designing"));
    expect(result.current.activeId).toBe("designing");
  });
});
```

- [ ] **Step 2: Implement**

```ts
"use client";
import { useEffect, useRef, useState } from "react";
import type { CanvasManifest } from "@atlas/canvas-runtime";

export function useCanvasState(input: { manifest: CanvasManifest | undefined; ritualId: string | undefined }) {
  const defaultId = input.manifest?.modes.find((m) => m.default)?.id ?? input.manifest?.modes[0]?.id ?? "";
  const [activeId, setActiveId] = useState(defaultId);
  const overrideRef = useRef(false);
  const lastRitualRef = useRef(input.ritualId);

  // Reset sticky override when ritualId changes
  useEffect(() => {
    if (lastRitualRef.current !== input.ritualId) {
      overrideRef.current = false;
      lastRitualRef.current = input.ritualId;
      setActiveId(defaultId);
    }
  }, [input.ritualId, defaultId]);

  return {
    activeId,
    setMode: (id: string) => {
      overrideRef.current = true;
      setActiveId(id);
    },
    suggestMode: (id: string) => {
      if (overrideRef.current) return;
      setActiveId(id);
    }
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/canvas/use-canvas-state.test.ts
git add apps/atlas-web/lib/canvas/use-canvas-state.ts apps/atlas-web/test/lib/canvas/use-canvas-state.test.ts
git commit -m "feat(atlas-web/canvas): useCanvasState hook (auto-switch + sticky manual override)"
```

---

### Task 17: atlas-web — `use-design-selection` hook (observes selected events)

**Files:**
- Create: `apps/atlas-web/lib/canvas/use-design-selection.ts`
- Create: `apps/atlas-web/test/lib/canvas/use-design-selection.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDesignSelection } from "@/lib/canvas/use-design-selection";

// Test the pure reducer that the hook composes; the hook integration with the
// EventSourceProvider is covered in CanvasShell integration tests.
import { foldDesignSelection } from "@/lib/canvas/use-design-selection";

describe("foldDesignSelection", () => {
  it("returns undefined when no selection event has arrived", () => {
    expect(foldDesignSelection([], "r-1")).toBeUndefined();
  });

  it("returns tokens from the most recent canvas.option.selected for that ritual", () => {
    const events = [
      { type: "canvas.option.selected", ritualId: "r-1", payload: { directionId: "x", tokens: { palette: { primary: "#000" } }, autoSelected: false } },
      { type: "canvas.option.selected", ritualId: "r-1", payload: { directionId: "y", tokens: { palette: { primary: "#111" } }, autoSelected: false } }
    ];
    const sel = foldDesignSelection(events as never, "r-1");
    expect(sel?.directionId).toBe("y");
  });

  it("ignores selection events for other rituals", () => {
    const events = [
      { type: "canvas.option.selected", ritualId: "r-2", payload: { directionId: "x", tokens: {}, autoSelected: false } }
    ];
    expect(foldDesignSelection(events as never, "r-1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

```ts
"use client";
import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

export interface DesignSelection {
  directionId: string;
  tokens: unknown;
  autoSelected: boolean;
}

export function foldDesignSelection(
  events: Array<{ type: string; ritualId: string; payload: unknown }>,
  ritualId: string | undefined
): DesignSelection | undefined {
  if (!ritualId) return undefined;
  let last: DesignSelection | undefined;
  for (const e of events) {
    if (e.type === "canvas.option.selected" && e.ritualId === ritualId) {
      const p = e.payload as DesignSelection;
      last = { directionId: p.directionId, tokens: p.tokens, autoSelected: p.autoSelected };
    }
  }
  return last;
}

export function useDesignSelection(ritualId: string | undefined): DesignSelection | undefined {
  const events = useEventStream();
  return useMemo(() => foldDesignSelection(events, ritualId), [events, ritualId]);
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/canvas/use-design-selection.test.ts
git add apps/atlas-web/lib/canvas/use-design-selection.ts apps/atlas-web/test/lib/canvas/use-design-selection.test.ts
git commit -m "feat(atlas-web/canvas): useDesignSelection hook + foldDesignSelection reducer"
```

---

### Task 18: atlas-web — `selectDesignDirection` Server Action

**Files:**
- Create: `apps/atlas-web/lib/canvas/select-design-direction.ts`
- Create: `apps/atlas-web/test/lib/canvas/select-design-direction.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/engine/factory", () => ({
  getCanvasPauseRegistry: vi.fn()
}));

import { getCanvasPauseRegistry } from "@/lib/engine/factory";
import { selectDesignDirection } from "@/lib/canvas/select-design-direction";

describe("selectDesignDirection", () => {
  it("calls registry.resolveOption with directionId + tokens", async () => {
    const resolveOption = vi.fn();
    (getCanvasPauseRegistry as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      resolveOption
    });
    await selectDesignDirection({
      ritualId: "r-1",
      directionId: "editorial-dark",
      tokens: { palette: { primary: "#000" } }
    });
    expect(resolveOption).toHaveBeenCalledWith("r-1", {
      directionId: "editorial-dark",
      tokens: { palette: { primary: "#000" } }
    });
  });

  it("surfaces a structured error when the registry throws", async () => {
    const resolveOption = vi.fn(() => { throw new Error("boom"); });
    (getCanvasPauseRegistry as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      resolveOption
    });
    const result = await selectDesignDirection({ ritualId: "r-1", directionId: "x", tokens: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Implement (Server Action)**

```ts
"use server";
import { getCanvasPauseRegistry } from "@/lib/engine/factory";

export async function selectDesignDirection(input: {
  ritualId: string;
  directionId: string;
  tokens: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const registry = await getCanvasPauseRegistry();
    registry.resolveOption(input.ritualId, { directionId: input.directionId, tokens: input.tokens });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 3: Stub `getCanvasPauseRegistry` in factory (will be wired in Task 24)**

For now, in `apps/atlas-web/lib/engine/factory.ts`, append at module scope:

```ts
import { CanvasPauseRegistry } from "@atlas/ritual-engine";
let _canvasPauseRegistry: CanvasPauseRegistry | undefined;
export async function getCanvasPauseRegistry(): Promise<CanvasPauseRegistry> {
  if (!_canvasPauseRegistry) _canvasPauseRegistry = new CanvasPauseRegistry();
  return _canvasPauseRegistry;
}
```

(The full factory wire-up in Task 24 will pass this same registry into the engine via `canvasPauseRegistry`.)

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/canvas/select-design-direction.test.ts
git add apps/atlas-web/lib/canvas/select-design-direction.ts apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/canvas/select-design-direction.test.ts
git commit -m "feat(atlas-web/canvas): selectDesignDirection Server Action + getCanvasPauseRegistry stub"
```

---

### Task 19: atlas-web — `<DesignerCanvas>` renderer (wraps S.3 OptionsCard)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/DesignerCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/DesignerCanvas.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesignerCanvas } from "@/components/canvas/renderers/DesignerCanvas";

const PROPOSAL = {
  recommended: { id: "editorial-dark", name: "Editorial Dark", shortDescription: "premium serif", technicalDescription: "shadcn + IBM Plex", citedReferences: ["Bombay Canteen"], tokens: { palette: { primary: "#000", accent: "#fbbf24", surface: "#fafafa", text: "#0a0a0a", muted: "#888" } } },
  alternates: [
    { id: "minimal-warm", name: "Minimal Warm", shortDescription: "y", technicalDescription: "z", citedReferences: [], tokens: { palette: { primary: "#fff", accent: "#000", surface: "#fff", text: "#000", muted: "#aaa" } } },
    { id: "premium-serif", name: "Premium Serif", shortDescription: "y", technicalDescription: "z", citedReferences: [], tokens: { palette: { primary: "#888", accent: "#000", surface: "#fff", text: "#000", muted: "#aaa" } } }
  ],
  reasoning: "matches premium signal"
};

describe("<DesignerCanvas>", () => {
  it("renders the recommended direction", () => {
    render(<DesignerCanvas proposal={PROPOSAL as never} ritualId="r-1" persona="ama" onSelect={() => {}} onRefine={() => {}} />);
    expect(screen.getByText(/editorial dark/i)).toBeInTheDocument();
  });

  it("clicking 'Use this' on the recommended fires onSelect with that id + tokens", () => {
    const onSelect = vi.fn();
    render(<DesignerCanvas proposal={PROPOSAL as never} ritualId="r-1" persona="diego" onSelect={onSelect} onRefine={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /use this/i })[0]!);
    expect(onSelect).toHaveBeenCalledWith({ directionId: "editorial-dark", tokens: PROPOSAL.recommended.tokens });
  });

  it("clicking refine fires onRefine with the direction id", () => {
    const onRefine = vi.fn();
    render(<DesignerCanvas proposal={PROPOSAL as never} ritualId="r-1" persona="diego" onSelect={() => {}} onRefine={onRefine} />);
    fireEvent.click(screen.getAllByRole("button", { name: /refine/i })[0]!);
    expect(onRefine).toHaveBeenCalledWith("editorial-dark");
  });

  it("ama persona renders OutcomeCard sub-component (no SQL/code visible)", () => {
    render(<DesignerCanvas proposal={PROPOSAL as never} ritualId="r-1" persona="ama" onSelect={() => {}} onRefine={() => {}} />);
    // OutcomeCard hides technicalDescription
    expect(screen.queryByText(/shadcn \+ IBM Plex/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import { OptionsCard } from "@/components/a2ui/OptionsCard";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface DesignerCanvasProps {
  proposal: {
    recommended: { id: string; name: string; shortDescription: string; technicalDescription: string; citedReferences: string[]; tokens: unknown };
    alternates: Array<{ id: string; name: string; shortDescription: string; technicalDescription: string; citedReferences: string[]; tokens: unknown }>;
    reasoning: string;
  };
  ritualId: string;
  persona: PersonaTier;
  onSelect: (sel: { directionId: string; tokens: unknown }) => void;
  onRefine: (directionId: string) => void;
}

export function DesignerCanvas({ proposal, persona, onSelect, onRefine }: DesignerCanvasProps) {
  return (
    <div className="h-full w-full overflow-auto bg-slate-50 p-6" data-testid="designer-canvas">
      <OptionsCard
        recommended={proposal.recommended}
        alternates={proposal.alternates}
        reasoning={proposal.reasoning}
        persona={persona}
        onSelect={(id, tokens) => onSelect({ directionId: id, tokens })}
        onRefine={onRefine}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/renderers/DesignerCanvas.test.tsx
git add apps/atlas-web/components/canvas/renderers/DesignerCanvas.tsx apps/atlas-web/test/components/canvas/renderers/DesignerCanvas.test.tsx
git commit -m "feat(atlas-web/canvas): DesignerCanvas renderer wraps S.3 OptionsCard at full canvas size"
```

---

### Task 20: atlas-web — `<RefineWizard>` renderer (wraps S.3 AxisWizard)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/RefineWizard.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/RefineWizard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefineWizard } from "@/components/canvas/renderers/RefineWizard";

const SEED_TOKENS = {
  palette: { primary: "#000", accent: "#fbbf24", surface: "#fafafa", text: "#0a0a0a", muted: "#888" },
  typeScale: { sansFamily: "Inter", monoFamily: "Geist Mono", baseSizePx: 16, scale: "minor-third" as const },
  density: "comfortable" as const
};

describe("<RefineWizard>", () => {
  it("renders palette/typography/density axes", () => {
    render(<RefineWizard fromDirectionId="x" seedTokens={SEED_TOKENS as never} onComplete={() => {}} />);
    expect(screen.getByText(/palette/i)).toBeInTheDocument();
    expect(screen.getByText(/typography/i)).toBeInTheDocument();
    expect(screen.getByText(/density/i)).toBeInTheDocument();
  });

  it("complete fires onComplete with merged tokens", async () => {
    const onComplete = vi.fn();
    render(<RefineWizard fromDirectionId="x" seedTokens={SEED_TOKENS as never} onComplete={onComplete} />);
    // Click the first option in each axis, then "Done"
    fireEvent.click(screen.getAllByTestId(/axis-option-/)[0]!);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onComplete).toHaveBeenCalledOnce();
    const merged = onComplete.mock.calls[0]![0] as { palette: unknown };
    expect(merged.palette).toBeDefined();
  });

  it("back button reverts to previous step", () => {
    render(<RefineWizard fromDirectionId="x" seedTokens={SEED_TOKENS as never} onComplete={() => {}} />);
    fireEvent.click(screen.getAllByTestId(/axis-option-/)[0]!);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    // back to palette
    expect(screen.getByTestId("axis-current-palette")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import { AxisWizard } from "@/components/a2ui/AxisWizard";

export interface RefineWizardProps {
  fromDirectionId: string;
  seedTokens: { palette: Record<string, string>; typeScale: Record<string, unknown>; density: string };
  onComplete: (mergedTokens: unknown) => void;
}

const AXES = [
  { id: "palette", label: "Palette", educationalTooltip: "The color foundation. Pairs that work together feel intentional." },
  { id: "typography", label: "Typography", educationalTooltip: "How your text feels — premium serif, modern sans, or technical mono." },
  { id: "density", label: "Density", educationalTooltip: "How much breathing room. Spacious feels editorial; compact feels productive." }
];

export function RefineWizard({ fromDirectionId, seedTokens, onComplete }: RefineWizardProps) {
  return (
    <div className="h-full w-full overflow-auto bg-slate-50 p-6" data-testid={`refine-wizard-${fromDirectionId}`}>
      <AxisWizard axes={AXES} seedValues={seedTokens} onComplete={onComplete} />
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/renderers/RefineWizard.test.tsx
git add apps/atlas-web/components/canvas/renderers/RefineWizard.tsx apps/atlas-web/test/components/canvas/renderers/RefineWizard.test.tsx
git commit -m "feat(atlas-web/canvas): RefineWizard renderer wraps S.3 AxisWizard with palette/typography/density axes"
```

---

### Task 21: atlas-web — `<PreviewCanvas>` renderer (wraps existing CanvasPreviewClient)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/PreviewCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/PreviewCanvas.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: ({ projectId, sandboxId, previewUrl }: { projectId: string; sandboxId: string; previewUrl?: string }) => (
    <div data-testid="canvas-preview-client" data-project={projectId} data-sandbox={sandboxId} data-url={previewUrl ?? ""} />
  )
}));

import { PreviewCanvas } from "@/components/canvas/renderers/PreviewCanvas";

describe("<PreviewCanvas>", () => {
  it("forwards projectId, sandboxId, previewUrl to CanvasPreviewClient", () => {
    render(<PreviewCanvas projectId="p-1" sandboxId="s-1" previewUrl="https://example/preview" />);
    const c = screen.getByTestId("canvas-preview-client");
    expect(c.getAttribute("data-project")).toBe("p-1");
    expect(c.getAttribute("data-sandbox")).toBe("s-1");
    expect(c.getAttribute("data-url")).toBe("https://example/preview");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import { CanvasPreviewClient } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient";

export interface PreviewCanvasProps {
  projectId: string;
  sandboxId: string;
  previewUrl?: string;
  previewError?: string;
}

export function PreviewCanvas(props: PreviewCanvasProps) {
  return <CanvasPreviewClient {...props} />;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/renderers/PreviewCanvas.test.tsx
git add apps/atlas-web/components/canvas/renderers/PreviewCanvas.tsx apps/atlas-web/test/components/canvas/renderers/PreviewCanvas.test.tsx
git commit -m "feat(atlas-web/canvas): PreviewCanvas renderer wraps existing CanvasPreviewClient"
```

---

### Task 22: atlas-web — `<SchemaCanvas>` renderer (persona-tiered backend schema picker)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemaCanvas } from "@/components/canvas/renderers/SchemaCanvas";

const SPEC_GRAPH = {
  kind: "backend-rest-api",
  tables: [
    { name: "tenants", columns: [{ name: "id", type: "uuid", primaryKey: true }] },
    { name: "users", columns: [{ name: "tenant_id", type: "uuid", references: "tenants.id" }] }
  ],
  rls: ["users → tenant_id = current_tenant_id()"]
};

describe("<SchemaCanvas>", () => {
  it("ama sees outcome cards (no schema/SQL)", () => {
    render(<SchemaCanvas specGraph={SPEC_GRAPH as never} persona="ama" />);
    expect(screen.getByText(/each customer fully isolated/i)).toBeInTheDocument();
    expect(screen.queryByText(/tenant_id/)).not.toBeInTheDocument();
  });

  it("diego sees schema cards (tables + RLS visible)", () => {
    render(<SchemaCanvas specGraph={SPEC_GRAPH as never} persona="diego" />);
    expect(screen.getByText(/tenants/)).toBeInTheDocument();
    expect(screen.getByText(/RLS/)).toBeInTheDocument();
  });

  it("priya sees schema cards too (matches diego)", () => {
    render(<SchemaCanvas specGraph={SPEC_GRAPH as never} persona="priya" />);
    expect(screen.getByText(/tenants/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface SchemaCanvasProps {
  specGraph: { kind: string; tables: Array<{ name: string; columns: Array<{ name: string; type: string; primaryKey?: boolean; references?: string }> }>; rls?: string[] };
  persona: PersonaTier;
}

export function SchemaCanvas({ specGraph, persona }: SchemaCanvasProps) {
  if (persona === "ama") {
    return (
      <div className="h-full w-full overflow-auto bg-slate-50 p-6" data-testid="schema-canvas-ama">
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-900">🛡️ Each customer fully isolated</p>
          <p className="mt-1 text-slate-600">Your data stays in its own lane. No customer can ever see another customer's data.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-auto bg-slate-50 p-6" data-testid={`schema-canvas-${persona}`}>
      <div className="space-y-3">
        {specGraph.tables.map((t) => (
          <div key={t.name} className="rounded-md border border-slate-200 bg-white p-4 font-mono text-xs">
            <div className="font-semibold text-slate-900">{t.name}</div>
            <ul className="mt-1 space-y-0.5">
              {t.columns.map((c) => (
                <li key={c.name}>
                  {c.name}: {c.type}
                  {c.primaryKey ? " PRIMARY KEY" : ""}
                  {c.references ? ` → ${c.references}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {specGraph.rls && specGraph.rls.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 font-mono text-xs">
            <div className="font-semibold">RLS</div>
            {specGraph.rls.map((r, i) => <div key={i}>{r}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/renderers/SchemaCanvas.test.tsx
git add apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx
git commit -m "feat(atlas-web/canvas): SchemaCanvas renderer (persona-tiered backend schema picker)"
```

---

### Task 23: atlas-web — `register-renderers.tsx` boot-time renderer registration

**Files:**
- Create: `apps/atlas-web/components/canvas/register-renderers.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { CanvasModeRegistry } from "@atlas/canvas-runtime";
import type { ComponentType } from "react";
import { DesignerCanvas } from "./renderers/DesignerCanvas";
import { RefineWizard } from "./renderers/RefineWizard";
import { PreviewCanvas } from "./renderers/PreviewCanvas";
import { SchemaCanvas } from "./renderers/SchemaCanvas";

export type CanvasRenderer = ComponentType<Record<string, unknown>>;

export function buildRendererRegistry(): CanvasModeRegistry<CanvasRenderer> {
  const registry = new CanvasModeRegistry<CanvasRenderer>();
  registry.register("designing", DesignerCanvas as unknown as CanvasRenderer);
  registry.register("refine", RefineWizard as unknown as CanvasRenderer);
  registry.register("preview", PreviewCanvas as unknown as CanvasRenderer);
  registry.register("schema", SchemaCanvas as unknown as CanvasRenderer);
  return registry;
}
```

No test (composition glue covered by `<CanvasShell>` integration test in Task 24).

- [ ] **Step 2: Commit**

```bash
git add apps/atlas-web/components/canvas/register-renderers.tsx
git commit -m "feat(atlas-web/canvas): boot-time renderer registry (designing/refine/preview/schema)"
```

---

### Task 24: atlas-web — `<CanvasShell>` polymorphic shell + integration test

**Files:**
- Create: `apps/atlas-web/components/canvas/CanvasShell.tsx`
- Create: `apps/atlas-web/test/components/canvas/CanvasShell.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasShell } from "@/components/canvas/CanvasShell";

const MANIFEST = {
  artifactKind: "frontend-app" as const,
  modes: [
    { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"] as const, default: true, blockingFor: "design" as const },
    { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] as const }
  ]
};

const PROPOSAL = {
  recommended: { id: "x", name: "X", shortDescription: "x", technicalDescription: "x", citedReferences: [], tokens: {} },
  alternates: [
    { id: "y", name: "Y", shortDescription: "y", technicalDescription: "y", citedReferences: [], tokens: {} },
    { id: "z", name: "Z", shortDescription: "z", technicalDescription: "z", citedReferences: [], tokens: {} }
  ],
  reasoning: "r"
};

vi.mock("@/lib/canvas/select-design-direction", () => ({
  selectDesignDirection: vi.fn().mockResolvedValue({ ok: true })
}));

describe("<CanvasShell>", () => {
  it("renders <EmptyCanvas> when no manifest", () => {
    render(<CanvasShell projectId="p" sandboxId="s" persona="diego" snapshot={{ canvasManifest: undefined } as never} />);
    expect(screen.getByTestId("canvas-empty")).toBeInTheDocument();
  });

  it("renders the default mode's renderer when manifest available", () => {
    render(
      <CanvasShell
        projectId="p"
        sandboxId="s"
        persona="diego"
        snapshot={{ canvasManifest: MANIFEST, ritualId: "r-1", proposal: PROPOSAL } as never}
      />
    );
    expect(screen.getByTestId("designer-canvas")).toBeInTheDocument();
  });

  it("clicking ModeToggle preview switches to PreviewCanvas (sticky override)", () => {
    render(
      <CanvasShell projectId="p" sandboxId="s" persona="diego" snapshot={{ canvasManifest: MANIFEST, ritualId: "r-1", proposal: PROPOSAL } as never} />
    );
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.queryByTestId("designer-canvas")).not.toBeInTheDocument();
  });

  it("hides modes filtered out by persona (ama on backend manifest)", () => {
    const backendManifest = {
      artifactKind: "backend-rest-api" as const,
      modes: [
        { id: "schema", renderer: "schema", audience: ["diego", "priya"] as const, default: true },
        { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] as const }
      ]
    };
    render(<CanvasShell projectId="p" sandboxId="s" persona="ama" snapshot={{ canvasManifest: backendManifest, ritualId: "r-1" } as never} />);
    // schema button absent for ama
    expect(screen.queryByRole("button", { name: /schema/i })).not.toBeInTheDocument();
  });

  it("clicking 'Use this' on a Designer card calls selectDesignDirection", async () => {
    const { selectDesignDirection } = await import("@/lib/canvas/select-design-direction");
    render(
      <CanvasShell projectId="p" sandboxId="s" persona="diego" snapshot={{ canvasManifest: MANIFEST, ritualId: "r-1", proposal: PROPOSAL } as never} />
    );
    fireEvent.click(screen.getAllByRole("button", { name: /use this/i })[0]!);
    expect(selectDesignDirection).toHaveBeenCalledWith({ ritualId: "r-1", directionId: "x", tokens: {} });
  });

  it("renders <EmptyCanvas> when no renderer matches the active mode (graceful degrade)", () => {
    const exoticManifest = {
      artifactKind: "frontend-app" as const,
      modes: [{ id: "exotic", renderer: "exotic", audience: ["diego"] as const, default: true }]
    };
    render(<CanvasShell projectId="p" sandboxId="s" persona="diego" snapshot={{ canvasManifest: exoticManifest, ritualId: "r-1" } as never} />);
    expect(screen.getByTestId("canvas-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import { useMemo } from "react";
import { personaFilter } from "@atlas/canvas-runtime";
import type { PersonaTier } from "@atlas/ritual-engine";
import { ModeToggle } from "./ModeToggle";
import { EmptyCanvas } from "./EmptyCanvas";
import { useCanvasState } from "@/lib/canvas/use-canvas-state";
import { buildRendererRegistry } from "./register-renderers";
import { selectDesignDirection } from "@/lib/canvas/select-design-direction";

export interface CanvasShellSnapshot {
  canvasManifest?: unknown;
  ritualId?: string;
  proposal?: unknown;
  selectedTokens?: unknown;
  specGraph?: unknown;
}

export interface CanvasShellProps {
  projectId: string;
  sandboxId: string;
  previewUrl?: string;
  previewError?: string;
  persona: PersonaTier;
  snapshot: CanvasShellSnapshot;
}

export function CanvasShell({ projectId, sandboxId, previewUrl, previewError, persona, snapshot }: CanvasShellProps) {
  const registry = useMemo(() => buildRendererRegistry(), []);
  const filtered = useMemo(() => {
    if (!snapshot.canvasManifest) return undefined;
    // Tolerant: snapshot.canvasManifest is `unknown` from the hydrator; the shell
    // trusts the engine's emission shape (validated at the engine boundary).
    return personaFilter(snapshot.canvasManifest as never, persona);
  }, [snapshot.canvasManifest, persona]);

  const state = useCanvasState({ manifest: filtered, ritualId: snapshot.ritualId });

  if (!filtered || filtered.modes.length === 0) {
    return <EmptyCanvas />;
  }

  const activeMode = filtered.modes.find((m) => m.id === state.activeId) ?? filtered.modes[0]!;
  const Renderer = registry.lookup(activeMode.renderer);
  if (!Renderer) {
    console.warn(`[CanvasShell] no renderer registered for "${activeMode.renderer}"`);
    return <EmptyCanvas />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-end border-b border-slate-200 bg-white px-3 py-2">
        <ModeToggle modes={filtered.modes} activeId={state.activeId} onSelect={state.setMode} />
      </div>
      <div className="flex-1 min-h-0">
        <Renderer
          // common props the renderers accept
          projectId={projectId}
          sandboxId={sandboxId}
          previewUrl={previewUrl}
          previewError={previewError}
          persona={persona}
          ritualId={snapshot.ritualId}
          proposal={snapshot.proposal}
          specGraph={snapshot.specGraph}
          onSelect={(sel: { directionId: string; tokens: unknown }) =>
            snapshot.ritualId && void selectDesignDirection({ ritualId: snapshot.ritualId, ...sel })
          }
          onRefine={() => state.setMode("refine")}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/CanvasShell.test.tsx
git add apps/atlas-web/components/canvas/CanvasShell.tsx apps/atlas-web/test/components/canvas/CanvasShell.test.tsx
git commit -m "feat(atlas-web/canvas): CanvasShell polymorphic shell + integration test"
```

---

### Task 25: atlas-web — wire `<CanvasShell>` into `app/projects/[projectId]/canvas/page.tsx`

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`
- Create: `apps/atlas-web/test/integration/canvas-flag-off-lock.test.tsx`

- [ ] **Step 1: Write the flag-OFF behavioural lock test**

Create `apps/atlas-web/test/integration/canvas-flag-off-lock.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags");
  return { ...actual, isFeatureEnabled: (flag: string) => false };
});

vi.mock("@/components/CanvasClient", () => ({ CanvasClient: () => <div data-testid="canvas-client" /> }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({ getOrProvision: async () => ({ previewUrl: "http://x", record: { sandboxId: "s" } }) })
}));
vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: () => <div data-testid="canvas-preview-client" />
}));

import CanvasPage from "@/app/projects/[projectId]/canvas/page";

describe("Canvas page — flag-OFF behavioural lock (Plan R behavior preserved)", () => {
  it("renders CanvasPreviewClient + CanvasClient + ChatPanel; no <CanvasShell> markers", async () => {
    const ui = await CanvasPage({ params: Promise.resolve({ projectId: "p-1" }) });
    const { queryByTestId } = render(ui as React.ReactElement);
    expect(queryByTestId("canvas-preview-client")).toBeInTheDocument();
    expect(queryByTestId("canvas-empty")).not.toBeInTheDocument();
    expect(queryByTestId("designer-canvas")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect green (flag-OFF: still today's behavior; new shell not yet wired)**

```bash
pnpm --filter atlas-web vitest run test/integration/canvas-flag-off-lock.test.tsx
```

- [ ] **Step 3: Modify `page.tsx`**

```tsx
import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { refineRitual } from "@/lib/actions/refineRitual";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";
import { CanvasShell } from "@/components/canvas/CanvasShell";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const graph = { nodes: {}, edges: [] };

  let previewUrl: string | undefined;
  let sandboxId = "";
  let previewError: string | undefined;
  try {
    const session = await getSandboxFactory().getOrProvision(projectId);
    previewUrl = session.previewUrl;
    sandboxId = session.record.sandboxId;
  } catch (err) {
    previewUrl = undefined;
    previewError = err instanceof Error ? err.message : String(err);
  }

  const liveEventsOn = isFeatureEnabled("live-events");
  const multiTurnOn = isFeatureEnabled("multi-turn");
  const canvasV1On = isFeatureEnabled("canvas-v1");

  // Flag ON: replace the right pane with <CanvasShell>.
  if (canvasV1On) {
    const { userId } = await auth();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prefs = new PreferencesRepo(pool);
    const personaOverride = userId ? await prefs.getOverride(userId, projectId) : undefined;
    const persona = (personaOverride ?? "ama") as "ama" | "diego" | "priya";

    // The snapshot is hydrated client-side (the hook reads from EventSourceProvider).
    // Server component passes a minimal initial snapshot for SSR; the client subscribes for live updates.
    const initialSnapshot = { canvasManifest: undefined, ritualId: undefined };

    return (
      <main className="flex h-full">
        <section className="flex-1 flex flex-col">
          <CanvasShell
            projectId={projectId}
            sandboxId={sandboxId}
            previewUrl={previewUrl}
            previewError={previewError}
            persona={persona}
            snapshot={initialSnapshot}
          />
          <CanvasClient graph={graph} projectId={projectId} />
        </section>
        {liveEventsOn ? null : (
          <ChatPanel projectId={projectId} action={startRitual} multiTurnFlagEnabled={multiTurnOn} refineAction={refineRitual} />
        )}
      </main>
    );
  }

  // Flag OFF: today's preview-only behavior preserved byte-for-byte.
  return (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        <CanvasPreviewClient projectId={projectId} sandboxId={sandboxId} previewUrl={previewUrl} previewError={previewError} />
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      {liveEventsOn ? null : (
        <ChatPanel projectId={projectId} action={startRitual} multiTurnFlagEnabled={multiTurnOn} refineAction={refineRitual} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Re-run flag-OFF lock — expect still green**

```bash
pnpm --filter atlas-web vitest run test/integration/canvas-flag-off-lock.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/page.tsx apps/atlas-web/test/integration/canvas-flag-off-lock.test.tsx
git commit -m "feat(atlas-web): canvas page wraps in <CanvasShell> when ATLAS_FF_CANVAS_V1=true; flag-OFF preserves Plan R"
```

---

### Task 26: atlas-web — extend `SpecEventsHydrator` with canvas snapshot fields (passthrough verify)

**Files:**
- Modify: `apps/atlas-web/lib/engine/spec-events-hydrator.ts` (assert no changes needed; add typing)
- Create: `apps/atlas-web/test/lib/engine/spec-events-hydrator-canvas.test.ts`

- [ ] **Step 1: Write failing/sanity test**

```ts
import { describe, it, expect } from "vitest";
import { SpecEventsHydrator } from "@/lib/engine/spec-events-hydrator";

class FakeRepo {
  rows: Array<{ id: bigint; eventType: string; payload: unknown; actor: string | null }> = [];
  async listByRitual() { return this.rows; }
}

describe("SpecEventsHydrator (canvas events)", () => {
  it("hydrate folds canvas.option.selected into snapshot.selectedTokens", async () => {
    const repo = new FakeRepo();
    repo.rows = [
      { id: 1n, eventType: "ritual.started", payload: { projectId: "p", userId: "u", intent: "x", editClass: "structural" }, actor: null },
      { id: 2n, eventType: "architect.canvas_manifest.emitted", payload: { manifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["ama"] }] } }, actor: null },
      { id: 3n, eventType: "canvas.option.selected", payload: { directionId: "x", tokens: { palette: { primary: "#000" } }, autoSelected: false }, actor: null }
    ];
    const h = new SpecEventsHydrator(repo as never, "p");
    const snap = await h.hydrate("r-1");
    expect(snap?.selectedTokens).toBeDefined();
    expect(snap?.canvasManifest).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect green** (Task 9 already updated the engine's `replayEventsToSnapshot`; the atlas-web hydrator just delegates)

```bash
pnpm --filter atlas-web vitest run test/lib/engine/spec-events-hydrator-canvas.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/engine/spec-events-hydrator-canvas.test.ts
git commit -m "test(atlas-web/engine): SpecEventsHydrator surfaces canvas snapshot fields"
```

---

### Task 27: atlas-web — register Researcher + Designer roles in `lib/engine/factory.ts`

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Create: `apps/atlas-web/test/lib/engine/factory-canvas-flag.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const flagState: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (f: string) => flagState[f] ?? false
}));

vi.mock("@atlas/role-researcher", () => ({
  ResearcherRole: vi.fn().mockImplementation(() => ({ id: "researcher", run: vi.fn() }))
}));
vi.mock("@atlas/role-designer", () => ({
  DesignerRole: vi.fn().mockImplementation(() => ({ id: "designer", run: vi.fn() }))
}));
// Stub other heavy deps so the factory module loads in unit-test env
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("@atlas/spec-graph-data", () => ({ PreferencesRepo: class {}, SpecEventRepo: class { constructor() {} } }));

describe("getRitualEngine — canvas flag wiring", () => {
  beforeEach(() => { for (const k of Object.keys(flagState)) delete flagState[k]; });

  it("flags OFF — neither researcher nor designer registered, canvasFlowEnabled=false", async () => {
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p-1");
    expect((engine as unknown as { canvasFlowEnabled: boolean }).canvasFlowEnabled).toBe(false);
  });

  it("canvas-v1 + researcher + designer flags ON — both roles registered + canvasFlowEnabled=true", async () => {
    flagState["canvas-v1"] = true;
    flagState["researcher-role"] = true;
    flagState["designer-role"] = true;
    process.env.ANTHROPIC_API_KEY = "test";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p-2");
    expect((engine as unknown as { canvasFlowEnabled: boolean }).canvasFlowEnabled).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
```

- [ ] **Step 2: Add the two sub-flags to `feature-flags.ts`**

Append to `FeatureFlag` union: `| "researcher-role" | "designer-role"`.
Append to `FLAG_TO_ENV`: `"researcher-role": "ATLAS_FF_RESEARCHER"`, `"designer-role": "ATLAS_FF_DESIGNER"`.
Append to `listFlagStates`.

- [ ] **Step 3: Modify `lib/engine/factory.ts`**

Inside the `if (llm)` block (after Security/Accessibility role registration), add:

```ts
if (isFeatureEnabled("researcher-role")) {
  const { ResearcherRole, BraveSearchAdapter } = await import("@atlas/role-researcher");
  const webAdapter = process.env.ATLAS_RESEARCH_WEB === "true" && process.env.BRAVE_SEARCH_API_KEY
    ? new BraveSearchAdapter({ apiKey: process.env.BRAVE_SEARCH_API_KEY })
    : null;
  roles.set("researcher", new ResearcherRole({ llm, webAdapter }));
}
if (isFeatureEnabled("designer-role")) {
  const { DesignerRole } = await import("@atlas/role-designer");
  roles.set("designer", new DesignerRole({ llm }));
}
```

Update the `RitualEngine` constructor call:

```ts
const canvasV1On = isFeatureEnabled("canvas-v1");
const canvasPauseRegistry = await getCanvasPauseRegistry();

return new RitualEngine({
  // ... existing options ...
  canvasFlowEnabled: canvasV1On,
  canvasPauseRegistry: canvasV1On ? canvasPauseRegistry : undefined
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/engine/factory-canvas-flag.test.ts
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/engine/factory-canvas-flag.test.ts
git commit -m "feat(atlas-web): register ResearcherRole + DesignerRole behind ATLAS_FF_RESEARCHER/DESIGNER; pass canvasPauseRegistry to engine"
```

---

### Task 28: Conductor checkpoint mapper — surface canvas events to broker

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts` (`mapCheckpointToBrokerEvent`)
- Create: `apps/atlas-web/test/lib/engine/factory-checkpoint-canvas.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
// mapCheckpointToBrokerEvent is module-internal; export it for testing.
import { mapCheckpointToBrokerEvent } from "@/lib/engine/factory";

describe("mapCheckpointToBrokerEvent (canvas)", () => {
  it("maps architect.canvas_manifest.emitted", () => {
    const r = mapCheckpointToBrokerEvent("architect.canvas_manifest.emitted", { manifest: {} });
    expect(r?.type).toBe("architect.canvas_manifest.emitted");
  });
  it("maps canvas.options.requested + canvas.option.selected", () => {
    expect(mapCheckpointToBrokerEvent("canvas.options.requested", {})?.type).toBe("canvas.options.requested");
    expect(mapCheckpointToBrokerEvent("canvas.option.selected", {})?.type).toBe("canvas.option.selected");
  });
  it("maps researcher + designer events", () => {
    expect(mapCheckpointToBrokerEvent("researcher.brief.completed", {})?.type).toBe("researcher.brief.completed");
    expect(mapCheckpointToBrokerEvent("designer.proposal.emitted", {})?.type).toBe("designer.proposal.emitted");
  });
});
```

- [ ] **Step 2: Modify `factory.ts`** — export `mapCheckpointToBrokerEvent` and add the canvas case branches:

```ts
case "architect.canvas_manifest.emitted": return { type: "architect.canvas_manifest.emitted", payload };
case "canvas.options.requested":           return { type: "canvas.options.requested",          payload };
case "canvas.option.selected":             return { type: "canvas.option.selected",            payload };
case "canvas.refinement.started":          return { type: "canvas.refinement.started",        payload };
case "canvas.refinement.completed":        return { type: "canvas.refinement.completed",      payload };
case "researcher.brief.completed":         return { type: "researcher.brief.completed",       payload };
case "researcher.brief.failed":            return { type: "researcher.brief.failed",          payload };
case "designer.proposal.emitted":          return { type: "designer.proposal.emitted",        payload };
case "designer.proposal.failed":           return { type: "designer.proposal.failed",         payload };
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/engine/factory-checkpoint-canvas.test.ts
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/engine/factory-checkpoint-canvas.test.ts
git commit -m "feat(atlas-web/engine): mapCheckpointToBrokerEvent surfaces canvas + researcher + designer events"
```

---

### Task 29: Architect role — emit `architect.canvas_manifest.emitted` on pass2 completion

**Files:**
- Modify: `packages/role-architect/src/role.ts`
- Create: `packages/role-architect/test/role-canvas-event.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { ArchitectRole } from "../src/role.js";
import { CanvasManifestSchema } from "@atlas/canvas-runtime";
import { SkillRegistry } from "@atlas/skill-runtime";

describe("ArchitectRole canvas event emission", () => {
  it("emits architect.canvas_manifest.emitted when artifact carries canvasManifest", async () => {
    const llmMock = {
      completeWithToolUse: vi.fn().mockResolvedValueOnce({ // triage
        toolName: "emit_ambiguity_report",
        input: { passed: true, scope: "new-app", questions: [] }
      }).mockResolvedValueOnce({ // deepPlan
        toolName: "emit_architect_output",
        input: { scope: "new-app", specGraph: { kind: "frontend-app" }, runnablePlan: { tasks: [] } }
      })
    };
    const role = new ArchitectRole({ llm: llmMock as never, skills: new SkillRegistry([]) });
    const result = await role.run({ ritualId: "r-1", graphVersion: 0, userTurn: "build a restaurant page", projectId: "p" });
    const ev = result.output.events.find((e) => e.eventType === "architect.canvas_manifest.emitted");
    expect(ev).toBeDefined();
    const parse = CanvasManifestSchema.safeParse((ev!.payload as { manifest: unknown }).manifest);
    expect(parse.success).toBe(true);
  });
});
```

- [ ] **Step 2: Modify `role.ts`** — after pass2 completes and the artifact contains canvasManifest, push an extra event before returning:

```ts
const artifact = parsedDeepPlan;
const events: RoleEvent[] = [...existingEvents];
if ((artifact as { canvasManifest?: unknown }).canvasManifest) {
  events.push({
    eventType: "architect.canvas_manifest.emitted",
    payload: { manifest: (artifact as { canvasManifest: unknown }).canvasManifest }
  });
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/role-architect test test/role-canvas-event.test.ts
git add packages/role-architect/src/role.ts packages/role-architect/test/role-canvas-event.test.ts
git commit -m "feat(role-architect): emit architect.canvas_manifest.emitted when artifact carries canvasManifest"
```

---

### Task 30: Engine — fast-mode short-circuit + RitualOptions.mode wiring

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts` (add `mode` to `StartInput`)
- Create: `packages/ritual-engine/test/engine-canvas-fast-mode.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry, InMemoryEventSink } from "../src/index.js";

const personaPrefs = { getPersona: async () => "diego" as const };

describe("Engine canvas flow — mode=fast", () => {
  it("skips Researcher dispatch when mode=fast", async () => {
    const sink = new InMemoryEventSink();
    const reg = new CanvasPauseRegistry();
    const researcherRun = vi.fn();

    const architect: Role = {
      id: "architect",
      async run() {
        return {
          roleId: "architect",
          output: {
            events: [{ eventType: "architect.pass2.completed", payload: { artifact: {
              scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] },
              graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
              canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["diego"], default: true, blockingFor: "design" }] }
            } } }],
            diff: { kind: "no-op" }
          }
        } as never;
      }
    } as unknown as Role;
    const researcher: Role = { id: "researcher", async run() { researcherRun(); return null as never; } } as never;
    const designer: Role = {
      id: "designer",
      async run() {
        return { roleId: "designer", output: { events: [{ eventType: "designer.proposal.emitted", payload: { proposal: { recommended: { id: "x", tokens: {} }, alternates: [{}, {}] } } }], diff: { kind: "no-op" } } } as never;
      }
    } as never;
    const developer: Role = {
      id: "developer",
      async run() { return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: {} }], diff: { kind: "no-op" } } } as never; }
    } as never;

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([["architect", architect], ["researcher", researcher], ["designer", designer], ["developer", developer]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const engine = new RitualEngine({
      conductor, eventSink: sink, personaPreferences: personaPrefs,
      canvasFlowEnabled: true, canvasPauseRegistry: reg, canvasPauseTimeoutMs: 1000, ritualMode: "fast"
    });

    setTimeout(() => {
      const ev = sink.events().find((e) => e.type === "ritual.started");
      if (ev) reg.resolveOption(ev.ritualId, { directionId: "x", tokens: {} });
    }, 5);

    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    expect(researcherRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Engine already accepts `ritualMode` from Task 8 — no implementation change.**

- [ ] **Step 3: Run — expect green**

```bash
pnpm --filter @atlas/ritual-engine test test/engine-canvas-fast-mode.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/ritual-engine/test/engine-canvas-fast-mode.test.ts
git commit -m "test(ritual-engine): canvas flow honors ritualMode=fast (skips researcher)"
```

---

### Task 31: Engine pause timeout integration test

**Files:**
- Create: `packages/ritual-engine/test/canvas-pause-timeout-integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry, InMemoryEventSink } from "../src/index.js";

const personaPrefs = { getPersona: async () => "diego" as const };

describe("Engine canvas pause — auto-select on timeout", () => {
  it("emits canvas.option.selected with autoSelected=true when timeout fires; developer still dispatches", async () => {
    const sink = new InMemoryEventSink();
    const reg = new CanvasPauseRegistry();
    const developerRun = vi.fn();

    const architect: Role = { id: "architect", async run() { return { roleId: "architect", output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }, canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["diego"], default: true, blockingFor: "design" }] } } } }], diff: { kind: "no-op" } } } as never; } } as never;
    const designer: Role = { id: "designer", async run() { return { roleId: "designer", output: { events: [{ eventType: "designer.proposal.emitted", payload: { proposal: { recommended: { id: "rec-direction", tokens: { palette: { primary: "#abc" } } }, alternates: [{}, {}] } } }], diff: { kind: "no-op" } } } as never; } } as never;
    const developer: Role = { id: "developer", async run(_c, opts: { priorArtifact?: unknown }) { developerRun(opts.priorArtifact); return { roleId: "developer", output: { events: [], diff: { kind: "no-op" } } } as never; } } as never;

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([["architect", architect], ["designer", designer], ["developer", developer]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const engine = new RitualEngine({
      conductor, eventSink: sink, personaPreferences: personaPrefs,
      canvasFlowEnabled: true, canvasPauseRegistry: reg, canvasPauseTimeoutMs: 50, ritualMode: "fast"
    });

    // No resolveOption call → timeout fires.
    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });

    const selected = sink.events().find((e) => e.type === "canvas.option.selected");
    expect(selected).toBeDefined();
    expect((selected!.payload as { autoSelected: boolean }).autoSelected).toBe(true);
    expect((selected!.payload as { directionId: string }).directionId).toBe("rec-direction");

    // Developer received the recommended tokens
    const priorArtifact = developerRun.mock.calls[0]![0] as { selectedTokens: { palette: { primary: string } } };
    expect(priorArtifact.selectedTokens.palette.primary).toBe("#abc");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @atlas/ritual-engine test test/canvas-pause-timeout-integration.test.ts
git add packages/ritual-engine/test/canvas-pause-timeout-integration.test.ts
git commit -m "test(ritual-engine): canvas pause timeout auto-selects recommended direction"
```

---

### Task 32: `.env.example` + docs update

**Files:**
- Modify: `apps/atlas-web/.env.example`
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Add to `.env.example`**

```
# Plan S.4 — Polymorphic Canvas (umbrella flag)
ATLAS_FF_CANVAS_V1=false
# Sub-flags (each independently dial-able for staged rollout)
ATLAS_FF_RESEARCHER=false
ATLAS_FF_DESIGNER=false
# Researcher web fetch (optional)
ATLAS_RESEARCH_WEB=false
BRAVE_SEARCH_API_KEY=
```

- [ ] **Step 2: Add a "Plan S.4 — wired" section to `local-dev-status.md`** with one paragraph describing what the canvas does + which flags to flip.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/.env.example docs/superpowers/local-dev-status.md
git commit -m "docs(plan-s4): .env.example + local-dev-status entry for canvas v1 flags"
```

---

### Task 33: Full-suite green + open PR

- [ ] **Step 1: Run the full repo test suite**

```bash
cd /f/claude/ai_builder
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

Expected: every package green. Resolve any cross-package fallout (most likely the engine's discriminated union parse in atlas-web's broker tests — extend mocks if needed).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin plan-s4/canvas-engine
```

- [ ] **Step 3: Open the PR with the standard plan template**

```bash
gh pr create --title "Plan S.4 — Polymorphic Canvas + Engine Integration" --body "$(cat <<'EOF'
## Summary
- Adds `@atlas/canvas-runtime` (CanvasManifest schema, persona filter, mode registry, canvas event union).
- Wires Researcher → Designer → canvas pause → Developer chain into RitualEngine behind `ATLAS_FF_CANVAS_V1`.
- Replaces Plan R right-panel content with `<CanvasShell>` (polymorphic, persona-aware) + 4 renderers (Designer, Refine, Preview, Schema).
- Architect emits `designIntent` + `canvasManifest` per artifactKind.
- Default OFF in code; flag-OFF preserves Plan R byte-for-byte (lock test included).

## Test plan
- [ ] `pnpm -r test` green
- [ ] Manual: flag OFF → today's preview-only behavior, no regressions
- [ ] Manual: flag ON + researcher + designer → ChatPanel send → Designer cards appear → click "Use this" → Developer runs with selected tokens → preview reloads
- [ ] Manual: flag ON, leave the page open 30 min → engine auto-selects recommended → ritual completes
- [ ] Manual: switch persona ama ↔ diego on a backend ritual → SchemaCanvas re-renders with correct framing

## Hand-off to S.5
- Visual-Quality gate hooks into `postDeveloperChain`; the Selected DesignTokens are now reachable on the snapshot via `selectedTokens` for the gate's critique prompt.
- Renderer registry + manifest are in place; visual-regression specs (Playwright snapshots) per renderer × persona × viewport land in S.5.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After CI passes + reviewer approval, squash-merge to `main` via the PR's GitHub UI.**

---

## Completion checklist

When every checkbox in every task above is checked, this plan is done. To verify:

- [ ] `pnpm -r test` green across all packages
- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm -r build` succeeds
- [ ] `apps/atlas-web/.env.example` documents `ATLAS_FF_CANVAS_V1`, `ATLAS_FF_RESEARCHER`, `ATLAS_FF_DESIGNER`, `ATLAS_RESEARCH_WEB`, `BRAVE_SEARCH_API_KEY`
- [ ] Flag-OFF behavioural lock test (`canvas-flag-off-lock.test.tsx`) green — Plan R byte-for-byte preserved
- [ ] Engine integration test (`engine-canvas-flow.test.ts`) green — full Architect → Researcher → Designer → pause → selected → Developer chain with `selectedTokens` flowing through
- [ ] Pause timeout test green — auto-select fires after timeout
- [ ] Manual smoke: with all three flags ON in a local `.env.local`, send a ritual via ChatPanel; Designer cards render; clicking "Use this →" resumes the ritual; preview reloads; persona toggle live-flips renderer framing

---

## Hand-off to Plan S.5

S.5 (`2026-05-02-plan-s5-visual-quality-gate.md`) consumes:

1. **`snapshot.selectedTokens`** — the gate's critique prompt reads these to detect "design-token drift" between what the user picked and what the developer rendered. Available on `RitualSnapshot` post-S.4.
2. **`canvasManifest` in snapshot** — the gate skips itself when no design-blocking mode was present (backend-only or refactor scopes). Available on `RitualSnapshot` post-S.4.
3. **Renderer registry** — S.5's Playwright visual-regression specs render each registered renderer against canned proposals/snapshots; the registry is the discovery mechanism so adding a renderer in v2 automatically gets a baseline (the spec iterates `registry.list()`).
4. **`<CanvasShell>` + `<ModeToggle>` markers** — S.5's `mode-toggle-states.spec.ts` relies on the `data-testid` attributes added in tasks 14, 15, 19, 20, 21, 22 to drive the snapshot capture.

S.5 ships behind `ATLAS_FF_VISUAL_QUALITY_GATE`. Lands the gate runner package, the L7-visual-advisory persona-tier registration, the `postDeveloperChain` integration (push `"visual-quality"` after `"accessibility"`), the full Playwright suite + `pnpm --filter atlas-web test:visual` script, and the `.github/workflows/visual-regression.yml` CI workflow on scoped paths.
