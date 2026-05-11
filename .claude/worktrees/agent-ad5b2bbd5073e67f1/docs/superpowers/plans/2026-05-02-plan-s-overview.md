# Plan S — UI Quality Uplift — Decomposition + Execution Order

**Spec:** `docs/superpowers/specs/2026-05-02-ui-quality-uplift-design.md`

**Why split:** The spec covers 5 sub-projects that share data contracts but each ships standalone working software. Per the writing-plans rule (sub-projects with their own implementation cycles), each gets its own plan, its own PR, its own merge.

---

## Sub-plan index

| # | File | Plan | Scope | Depends on | Approx weeks |
|---|---|---|---|---|---|
| S.1 | `2026-05-02-plan-s1-sandbox-uplift.md` | **Sandbox Uplift** — rebuild `atlas-next-ts` E2B template with Tailwind + shadcn + lucide really installed; rewrite `SANDBOX_CONTEXT_PROMPT` from negative-list to positive-list; republish E2B image | Independent — ships immediate quality lift on its own | 1 |
| S.2 | `2026-05-02-plan-s2-researcher-catalog.md` | **Researcher Role + Local Catalog** — `@atlas/role-researcher` (Brave Search adapter behind `ATLAS_RESEARCH_WEB`); local YAML catalog of ~30 categories; `InspirationBrief` Zod schema + tests; behind `ATLAS_FF_RESEARCHER` | Independent of frontend; can be developed in parallel with S.1 | 2 |
| S.3 | `2026-05-02-plan-s3-designer-a2ui.md` | **Designer Role + A2UI Primitive** — `@atlas/role-designer` (Pattern C proposal + Pattern B refine); `DesignProposal` / `DesignTokens` Zod; `<OptionsCard>` / `<AxisWizard>` / `<OutcomeCard>` / `<TechnicalCard>` reusable React components; behind `ATLAS_FF_DESIGNER` | S.2 (consumes `InspirationBrief`); the React A2UI primitives can be built standalone | 2.5 |
| S.4 | `2026-05-02-plan-s4-canvas-engine.md` | **Polymorphic Canvas + Engine Integration** — `@atlas/canvas-runtime` (CanvasManifest + persona filter + registry); `<CanvasShell>` replaces Plan R right panel; `<ModeToggle>` + `<EmptyCanvas>` + per-mode renderers (`DesignerCanvas`, `RefineWizard`, `PreviewCanvas`, `SchemaCanvas`); RitualEngine dispatch updates (Researcher → Designer → canvas pause → Developer); `[projectId]/canvas/page.tsx` rework; behind `ATLAS_FF_CANVAS_V1` umbrella | S.2 + S.3 (needs proposals to render) | 3 |
| S.5 | `2026-05-02-plan-s5-visual-quality-gate.md` | **Visual-Quality Gate + Visual Regression Tests** — `@atlas/gate-visual-quality` (puppeteer-core in sandbox + multimodal critique LLM + `VisualQualityReport`); L7-visual-advisory persona-tier registered in `risk-accept.ts`; integration into `postDeveloperChain`; full Playwright visual-regression suite per renderer × persona × viewport with in-repo PNG baselines; CI workflow on scoped paths; `pnpm --filter atlas-web test:visual` script; behind `ATLAS_FF_VISUAL_QUALITY_GATE` | S.4 (needs canvas renderers to snapshot) | 1.5 |

**Total: ~10 weeks of work, 5 PRs.** Each PR is mergeable independently behind feature flags. Nothing turns on for end users until the final demo flag flip after all 5 land.

---

## Execution dependency graph

```
S.1 Sandbox Uplift ─────────────────────────────────┐
                                                    │
S.2 Researcher + Catalog ──┐                        │
                           ├─→ S.3 Designer + A2UI ─┤
                           │                        │
                           │                        ├─→ S.4 Canvas + Engine ─→ S.5 Visual-Quality + Tests
                           │                        │
                           └────────────────────────┘
```

- **S.1 stands alone.** Can be done first or in parallel with S.2.
- **S.2 → S.3** because Designer's prompt references the InspirationBrief shape; the Designer can run with `brief: null` for early dev though, so S.3 is partially parallelizable.
- **S.4 needs both S.2 + S.3** to wire the engine pipeline end-to-end.
- **S.5 needs S.4** because the Visual-Quality gate snapshots rendered canvas + preview, both of which require the canvas shell to exist.

If two engineers are available, the parallelization is: one starts S.1+S.4, the other starts S.2+S.3+S.5.

If one engineer: do them in S.1 → S.2 → S.3 → S.4 → S.5 order.

---

## Feature-flag rollout sequence

All flags default OFF in code. Flag-OFF for any flag preserves pre-feature behavior byte-for-byte.

1. **S.1 lands** → republish E2B image. No flag — sandbox is just better. Existing prompts adapt (developer can now use Tailwind without crashing). Verify nothing in main regressed via `pnpm -r test` + a local manual prompt.
2. **S.2 lands** → `ATLAS_FF_RESEARCHER=true` in dev `.env.local` for testing. ResearcherRole runs but its output is not consumed by any downstream role yet (Designer doesn't exist). Tests verify schema and isolated functionality.
3. **S.3 lands** → `ATLAS_FF_DESIGNER=true`. Designer dispatches if Researcher's output exists, else runs without brief. A2UI primitives unit-tested in isolation; not yet rendered in any page.
4. **S.4 lands** → `ATLAS_FF_CANVAS_V1=true`. The whole pipeline wires up; ChatPanel renders the new canvas; users get the design picker.
5. **S.5 lands** → `ATLAS_FF_VISUAL_QUALITY_GATE=true`. Critique gate runs after sandbox.apply; failures escalate via Plan L auto-fix.
6. **Demo flag flip** — small follow-up PR adds all five flags to `apps/atlas-web/.env.example` set to `true`; updates `docs/superpowers/demo-runbook.md`.
7. **Default-on cutover** — separate PR after a soak window. Removes the OFF branch from `<ProjectLayout>` and the role registration; the flags become no-ops.

---

## Out of scope across all of Plan S

These belong to v2 follow-up plans, not this rollout:

- Backend Endpoints / Exerciser / Logs canvas modes (only Schema mode in v1)
- Mobile / data-pipeline / CLI canvas modes
- Per-component visual-edit overlay (Lovable click-to-edit)
- Multi-tenant brand-kit injection
- Object-storage adapter for screenshot bytes (v1 stores in `spec_events.payload`)
- Persistent inspiration cache that auto-grows from approved web hits (v1 catalog is hand-curated YAML)
- Designer multimodal critique using Opus (v1 default = Sonnet)

---

## Tracking

When all 5 plans merge to `main`:
- Tag `plan-s/v1-complete` on `main`.
- Update `docs/superpowers/plans/README.md` Plan index with all 5 entries marked Shipped.
- Open Plan S.v2 kickoff issue covering the deferred items above.
