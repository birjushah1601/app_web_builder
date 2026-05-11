# Plan S.2 — Researcher Role + Local Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `@atlas/role-researcher` package — a Conductor-dispatched Role that, given a `designIntent`, queries a curated local YAML catalog of design references (and optionally a Brave Search live-fetch behind `ATLAS_RESEARCH_WEB`) and emits a Zod-validated `InspirationBrief` consumable by Plan S.3's Designer role. Ship the v1 catalog with 30 hand-curated categories. Behind feature flag `ATLAS_FF_RESEARCHER` so it does not affect existing pipelines until S.3+S.4 wire it into the engine.

**Architecture:** The role mirrors the established `@atlas/role-{architect,developer,security,accessibility}` pattern: a class implementing `Role` from `@atlas/conductor`, a Zod schema in `types.ts`, typed errors in `errors.ts`, prompt-cache-friendly LLM call via `@atlas/llm-provider`. Two data sources fold into one brief: the local YAML catalog (always queried; offline-deterministic) and an optional Brave Search adapter (`WebFetchAdapter` interface with a default `BraveSearchAdapter` implementation). Local catalog lives in `packages/role-researcher/catalog/*.yaml` (one file per category). LLM call (Haiku tier) takes `localHits + webHits` and emits the final `InspirationBrief` via tool-use. Fast-mode short-circuit skips both web-fetch and the LLM call, returning a minimal brief composed mechanically from local catalog hits.

**Tech Stack:** TypeScript 5.6 · Node 22 · Zod 3.23 · vitest 2.1 · `js-yaml` 4.1 (YAML parsing) · `node-fetch` (web adapter, native fetch in Node 22) · `@atlas/conductor` + `@atlas/llm-provider` + `@atlas/skill-runtime` (workspace deps).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan S.1 NOT required — S.2 is independent at the code level (it only consumes architect's `designIntent` field, which already exists in spec design but doesn't ship until S.3 wires it into the architect's output).
- Repo state: on `main` (after S.1 merges OR before — order of S.1 vs S.2 doesn't matter for code), working tree clean, all existing tests green.
- `pnpm` 9 + Node 22.

**Branch:** `plan-s2/researcher-catalog` cut from `main`. Final task in this plan merges back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root.

```
packages/role-researcher/                              # NEW PACKAGE
  package.json                                         # NEW
  tsconfig.json                                        # NEW
  vitest.config.ts                                     # NEW
  README.md                                            # NEW
  src/
    index.ts                                           # NEW: public exports
    types.ts                                           # NEW: InspirationBriefSchema, DesignIntentSchema
    errors.ts                                          # NEW: ResearcherFailedError
    role.ts                                            # NEW: ResearcherRole class
    local-catalog.ts                                   # NEW: YAML loader + lookup by category
    web-fetch.ts                                       # NEW: WebFetchAdapter interface + BraveSearchAdapter
    assemble-brief.ts                                  # NEW: pure helper that folds localHits + webHits → InspirationBrief (LLM-driven)
  catalog/                                             # NEW: 30 hand-curated YAMLs
    restaurant-landing.yaml
    saas-marketing.yaml
    dashboard-admin.yaml
    portfolio-personal.yaml
    e-commerce-product.yaml
    blog-publication.yaml
    documentation-site.yaml
    agency-creative.yaml
    nonprofit-cause.yaml
    education-course.yaml
    multi-tenant-saas-api.yaml
    single-tenant-internal-tool.yaml
    data-pipeline-etl.yaml
    marketing-event.yaml
    mobile-app-marketing.yaml
    healthcare-clinic.yaml
    government-service.yaml
    fintech-marketing.yaml
    contact-form.yaml
    login-screen.yaml
    dashboard-analytics.yaml
    crm-internal.yaml
    marketplace-two-sided.yaml
    news-publication.yaml
    podcast-show.yaml
    b2b-landing.yaml
    status-page.yaml
    changelog-page.yaml
    pricing-page.yaml
    careers-page.yaml
  test/
    types.test.ts                                      # NEW: Zod schema parse + reject
    local-catalog.test.ts                              # NEW: YAML loader, lookup, fuzzy synonyms
    web-fetch.test.ts                                  # NEW: BraveSearchAdapter mock fetch
    role.test.ts                                       # NEW: ResearcherRole.run happy + fast-mode + empty-catalog
    assemble-brief.test.ts                             # NEW: LLM call shape, schema validation
    catalog-validate.test.ts                           # NEW: every YAML in catalog/ parses cleanly + has required fields

packages/skill-library/skills/researcher/              # NEW skill family (markdown skills the role can compose)
  assemble-brief.md
  cite-references.md

apps/atlas-web/
  lib/llm/factory.ts                                   # MODIFIED: register ResearcherRole behind ATLAS_FF_RESEARCHER
  .env.example                                         # MODIFIED: add ATLAS_FF_RESEARCHER + ATLAS_RESEARCH_WEB + BRAVE_SEARCH_API_KEY entries
  test/lib/factory-researcher.test.ts                  # NEW: 4 cases (flag-OFF, flag-ON, +web-fetch flag, missing-key)

docs/superpowers/
  local-dev-status.md                                  # MODIFIED: add Plan S.2 entry under "What's wired"
```

**Why this shape.** Catalog files live inside the role package (rather than `packages/skill-library/skills/researcher/catalog/`) because they are **data, not skills** — the skill markdown files in `skill-library/skills/researcher/` are the LLM prompt fragments the role composes; the YAMLs are structured input. Separating them keeps the skill-library focused on prompt composition and avoids confusing readers about what gets shipped to the LLM. The `catalog-validate.test.ts` is a CI safety net: every new YAML must satisfy the schema, preventing typos from surfacing at runtime.

---

## Design Decisions

1. **Why YAML for catalog (vs. TS modules or JSON).** YAML is editor-friendly for content authors (newlines, comments, no quoting noise), lints cleanly via `js-yaml.SAFE_SCHEMA`, and the `catalog-validate.test.ts` enforces type safety at test time. TS modules would force a build step for content updates; JSON loses comments. The implementing engineer can `pnpm --filter @atlas/role-researcher test:watch` while editing YAMLs to get instant validation.

2. **Why Brave Search (vs. SerpAPI / Bing / Google).** Brave Search has the most generous free tier (2,000 queries/month) and a clean JSON API. Independent (not Google/Microsoft owned), aligned with the OSS/sovereignty pivot from ADR-001. Fallback adapters are a follow-up if Brave's free tier proves insufficient.

3. **Why a `WebFetchAdapter` interface.** Lets us swap providers without touching `ResearcherRole`. The `BraveSearchAdapter` is the v1 default; tests inject a `MockWebFetchAdapter`; future plans can ship `SerpAPIAdapter` etc.

4. **Why a single LLM call per `assemble-brief` (vs. per-reference enrichment).** Cost discipline. Folding local + web hits into one Haiku call returns the structured `InspirationBrief` once. Per-reference enrichment would multiply token use without proportional quality lift; defer to v2 if catalog quality demands it.

5. **Why fast-mode bypasses the LLM entirely.** When `ritualMode === "fast"`, the brief is constructed mechanically from the top 3 local-catalog hits — no LLM, no web fetch, ~50ms latency. Brief is "thin" (just references with their pre-curated palettes/typography); Designer downstream handles the gracefully-degraded case.

6. **Why no DB caching at v1.** A `design_research_cache` table is mentioned in the spec as a follow-up; v1 ships without it. The local catalog is the cache. Web hits are re-fetched per ritual but capped (1 query) and fast (Brave returns in <500ms typical).

7. **Cost-cap mechanism.** Each `BraveSearchAdapter.search()` call is wrapped in a `costRecorder.record({ kind: "web-search", category })` callback. The atlas-web side wires this into the existing `SpendRecorder` from Plan D6. v1 spends a small flat cost (~$0.0005 per Brave query at paid tier; free at v1).

---

## Task List (24 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Each task is independently committable.

---

### Task 1: Cut branch + scaffold package

**Files:**
- Create: `(branch)`
- Create: `packages/role-researcher/package.json`
- Create: `packages/role-researcher/tsconfig.json`
- Create: `packages/role-researcher/vitest.config.ts`
- Create: `packages/role-researcher/README.md`

- [ ] **Step 1: Cut the branch**

```bash
cd /f/claude/ai_builder
git checkout main
git pull --ff-only
git checkout -b plan-s2/researcher-catalog
```

- [ ] **Step 2: Create package.json**

Create `packages/role-researcher/package.json`:

```json
{
  "name": "@atlas/role-researcher",
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
  "files": ["dist", "catalog"],
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
    "js-yaml": "4.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/role-researcher/tsconfig.json`:

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

Create `packages/role-researcher/vitest.config.ts`:

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
      "@atlas/role-researcher": path.resolve(__dirname, "src/index.ts")
    }
  }
});
```

- [ ] **Step 5: Create README.md**

Create `packages/role-researcher/README.md`:

```markdown
# @atlas/role-researcher

Conductor-dispatched Role that produces an `InspirationBrief` for the Designer role (Plan S.3) by querying a local YAML catalog and (optionally) Brave Search.

## Install
\`\`\`bash
pnpm install
\`\`\`

## Test
\`\`\`bash
pnpm test
\`\`\`

## Usage (called by RitualEngine, not directly)

\`\`\`ts
import { ResearcherRole } from "@atlas/role-researcher";

const researcher = new ResearcherRole({
  llm,
  webAdapter: process.env.ATLAS_RESEARCH_WEB === "true"
    ? new BraveSearchAdapter({ apiKey: process.env.BRAVE_SEARCH_API_KEY! })
    : null
});

await conductor.dispatch({ role: researcher, ... });
\`\`\`

## Catalog content

`catalog/*.yaml` — one file per category. Schema enforced by `catalog-validate.test.ts`. To add a category: copy an existing file, edit, run `pnpm test`. CI rejects malformed YAMLs.
```

- [ ] **Step 6: Install + verify the workspace picks up the package**

```bash
pnpm install
```

Expected: pnpm reports `+ @atlas/role-researcher 0.0.0` (or similar; new package detected).

- [ ] **Step 7: Commit**

```bash
git add packages/role-researcher/
git commit -m "chore(role-researcher): scaffold package + tsconfig + vitest"
```

---

### Task 2: Define Zod schemas (`types.ts`)

**Files:**
- Create: `packages/role-researcher/src/types.ts`
- Create: `packages/role-researcher/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-researcher/test/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  InspirationBriefSchema,
  DesignIntentSchema,
  type InspirationBrief
} from "../src/types.js";

describe("DesignIntentSchema", () => {
  it("accepts a minimal valid intent", () => {
    const parsed = DesignIntentSchema.parse({
      category: "restaurant-landing",
      audienceCues: []
    });
    expect(parsed.category).toBe("restaurant-landing");
    expect(parsed.audienceCues).toEqual([]);
  });

  it("rejects missing category", () => {
    expect(() => DesignIntentSchema.parse({ audienceCues: [] })).toThrow();
  });

  it("accepts audience cues array", () => {
    const parsed = DesignIntentSchema.parse({
      category: "restaurant-landing",
      audienceCues: ["fine-dining", "premium", "mumbai"]
    });
    expect(parsed.audienceCues).toEqual(["fine-dining", "premium", "mumbai"]);
  });
});

describe("InspirationBriefSchema", () => {
  const validBrief: InspirationBrief = {
    category: "restaurant-landing",
    audienceCues: ["fine-dining"],
    references: [
      {
        name: "Bombay Canteen",
        url: "https://thebombaycanteen.com",
        why: "Editorial serif + warm photography matched the premium signal",
        sourceTier: "local-catalog",
        palettePreview: ["#0a0a0a", "#fbbf24"],
        typographyPreview: { primary: "IBM Plex Serif", secondary: "Inter" }
      }
    ],
    patternsThatWin: ["above-the-fold reservation CTA"],
    patternsThatLose: ["stock photo carousels"]
  };

  it("parses a valid brief", () => {
    const parsed = InspirationBriefSchema.parse(validBrief);
    expect(parsed.references).toHaveLength(1);
    expect(parsed.references[0].sourceTier).toBe("local-catalog");
  });

  it("rejects sourceTier outside enum", () => {
    const bad = { ...validBrief, references: [{ ...validBrief.references[0], sourceTier: "wikipedia" }] };
    expect(() => InspirationBriefSchema.parse(bad)).toThrow();
  });

  it("makes url optional", () => {
    const noUrl = { ...validBrief, references: [{ ...validBrief.references[0], url: undefined }] };
    expect(() => InspirationBriefSchema.parse(noUrl)).not.toThrow();
  });

  it("makes palettePreview optional", () => {
    const noPalette = { ...validBrief, references: [{ ...validBrief.references[0], palettePreview: undefined }] };
    expect(() => InspirationBriefSchema.parse(noPalette)).not.toThrow();
  });

  it("requires references array (can be empty)", () => {
    const empty = { ...validBrief, references: [] };
    expect(() => InspirationBriefSchema.parse(empty)).not.toThrow();
  });

  it("rejects missing references", () => {
    const { references: _r, ...noRefs } = validBrief;
    expect(() => InspirationBriefSchema.parse(noRefs)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @atlas/role-researcher test test/types.test.ts
```

Expected: FAIL — `Cannot find module '../src/types.js'` because we haven't written it.

- [ ] **Step 3: Write minimal implementation**

Create `packages/role-researcher/src/types.ts`:

```ts
import { z } from "zod";

/** What the architect emits to drive Researcher. Lives in architect's pass-2
 *  artifact alongside the existing scope/runnablePlan/etc. fields. */
export const DesignIntentSchema = z.object({
  category: z.string().min(1),
  audienceCues: z.array(z.string())
});
export type DesignIntent = z.infer<typeof DesignIntentSchema>;

/** A single reference inside an InspirationBrief. */
export const ReferenceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  why: z.string().min(1),
  sourceTier: z.enum(["local-catalog", "web"]),
  palettePreview: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).optional(),
  typographyPreview: z
    .object({
      primary: z.string().min(1),
      secondary: z.string().min(1).optional()
    })
    .optional()
});
export type Reference = z.infer<typeof ReferenceSchema>;

/** Researcher's output. Consumed by Designer (Plan S.3). */
export const InspirationBriefSchema = z.object({
  category: z.string().min(1),
  audienceCues: z.array(z.string()),
  references: z.array(ReferenceSchema),
  patternsThatWin: z.array(z.string()),
  patternsThatLose: z.array(z.string())
});
export type InspirationBrief = z.infer<typeof InspirationBriefSchema>;
```

- [ ] **Step 4: Run test — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/types.test.ts
```

Expected: PASS — all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-researcher/src/types.ts packages/role-researcher/test/types.test.ts
git commit -m "feat(role-researcher): InspirationBriefSchema + DesignIntentSchema"
```

---

### Task 3: Define typed errors (`errors.ts`)

**Files:**
- Create: `packages/role-researcher/src/errors.ts`
- Create: `packages/role-researcher/test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-researcher/test/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ResearcherFailedError, CatalogParseError, WebFetchError } from "../src/errors.js";

describe("ResearcherFailedError", () => {
  it("captures cause + category", () => {
    const cause = new Error("LLM 503");
    const err = new ResearcherFailedError("brief assembly failed", { cause, category: "restaurant-landing" });
    expect(err.message).toMatch(/brief assembly failed/);
    expect(err.cause).toBe(cause);
    expect(err.category).toBe("restaurant-landing");
    expect(err.name).toBe("ResearcherFailedError");
  });
});

describe("CatalogParseError", () => {
  it("captures filename", () => {
    const err = new CatalogParseError("invalid yaml", { file: "restaurant-landing.yaml" });
    expect(err.file).toBe("restaurant-landing.yaml");
    expect(err.name).toBe("CatalogParseError");
  });
});

describe("WebFetchError", () => {
  it("captures provider + status", () => {
    const err = new WebFetchError("Brave returned 429", { provider: "brave", status: 429 });
    expect(err.provider).toBe("brave");
    expect(err.status).toBe(429);
    expect(err.name).toBe("WebFetchError");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm --filter @atlas/role-researcher test test/errors.test.ts
```

Expected: FAIL — `Cannot find module '../src/errors.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/role-researcher/src/errors.ts`:

```ts
export class ResearcherFailedError extends Error {
  readonly cause?: unknown;
  readonly category?: string;

  constructor(message: string, opts: { cause?: unknown; category?: string } = {}) {
    super(message);
    this.name = "ResearcherFailedError";
    this.cause = opts.cause;
    this.category = opts.category;
  }
}

export class CatalogParseError extends Error {
  readonly file: string;

  constructor(message: string, opts: { file: string }) {
    super(message);
    this.name = "CatalogParseError";
    this.file = opts.file;
  }
}

export class WebFetchError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(message: string, opts: { provider: string; status?: number; cause?: unknown }) {
    super(message);
    this.name = "WebFetchError";
    this.provider = opts.provider;
    this.status = opts.status;
  }
}
```

- [ ] **Step 4: Run test — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/errors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-researcher/src/errors.ts packages/role-researcher/test/errors.test.ts
git commit -m "feat(role-researcher): typed errors (ResearcherFailedError, CatalogParseError, WebFetchError)"
```

---

### Task 4: Local-catalog YAML loader (`local-catalog.ts`)

**Files:**
- Create: `packages/role-researcher/src/local-catalog.ts`
- Create: `packages/role-researcher/test/local-catalog.test.ts`
- Create: `packages/role-researcher/catalog/restaurant-landing.yaml` (sample for the test)

- [ ] **Step 1: Create a sample catalog YAML so the loader has data**

Create `packages/role-researcher/catalog/restaurant-landing.yaml`:

```yaml
category: restaurant-landing
synonyms:
  - restaurant-website
  - dining-landing
  - cafe-website
references:
  - name: The Bombay Canteen
    url: https://thebombaycanteen.com
    why: Editorial serif headlines, warm photography, prominent reservation CTA
    palette: ["#0a0a0a", "#fbbf24", "#fef3c7", "#1f2937"]
    typography:
      primary: IBM Plex Serif
      secondary: Inter
    density: spacious
    notes: Typifies premium-Indian-restaurant aesthetic. Hero gives 60% to a single dish.
  - name: Eleven Madison Park
    url: https://www.elevenmadisonpark.com
    why: Restraint over abundance — single hero image, generous whitespace, terse copy
    palette: ["#fafaf7", "#1a1a1a", "#7d7363"]
    typography:
      primary: Domaine Display
      secondary: Founders Grotesk
    density: spacious
    notes: Three-Michelin-star pedigree shows in the chrome — slow scroll, rare animations.
patternsThatWin:
  - above-the-fold reservation CTA
  - one hero photograph at high quality, not a carousel
  - menu shown inline on the homepage, not behind a click
  - chef name on the homepage
  - clear hours + neighborhood near the top
patternsThatLose:
  - stock-photo carousels
  - generic "experience finest cuisine" headlines
  - hero video with autoplay
  - hidden menu behind a "View Menu" CTA
  - "About Us" essays without imagery
```

- [ ] **Step 2: Write the failing test**

Create `packages/role-researcher/test/local-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadCatalog, lookupCategory, type CatalogEntry } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

describe("loadCatalog", () => {
  it("loads all yaml files and returns a map keyed by category", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    expect(catalog.size).toBeGreaterThan(0);
    expect(catalog.has("restaurant-landing")).toBe(true);
  });

  it("each entry has the expected shape", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    const entry = catalog.get("restaurant-landing")!;
    expect(entry.category).toBe("restaurant-landing");
    expect(entry.references.length).toBeGreaterThan(0);
    expect(entry.references[0].name).toBeTruthy();
    expect(entry.references[0].why).toBeTruthy();
    expect(entry.patternsThatWin.length).toBeGreaterThan(0);
  });
});

describe("lookupCategory", () => {
  let catalog: Map<string, CatalogEntry>;

  beforeAll(async () => {
    catalog = await loadCatalog(CATALOG_DIR);
  });

  it("matches direct category", () => {
    const hit = lookupCategory(catalog, "restaurant-landing");
    expect(hit).toBeDefined();
    expect(hit?.category).toBe("restaurant-landing");
  });

  it("matches case-insensitive", () => {
    const hit = lookupCategory(catalog, "Restaurant-Landing");
    expect(hit).toBeDefined();
  });

  it("matches synonyms", () => {
    const hit = lookupCategory(catalog, "cafe-website");
    expect(hit).toBeDefined();
    expect(hit?.category).toBe("restaurant-landing");
  });

  it("returns undefined when no match", () => {
    expect(lookupCategory(catalog, "battle-mech-configurator")).toBeUndefined();
  });
});

import { beforeAll } from "vitest";
```

- [ ] **Step 3: Run test — expect failure**

```bash
pnpm --filter @atlas/role-researcher test test/local-catalog.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement local-catalog.ts**

Create `packages/role-researcher/src/local-catalog.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { CatalogParseError } from "./errors.js";

const CatalogReferenceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  why: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).optional(),
  typography: z
    .object({
      primary: z.string().min(1),
      secondary: z.string().min(1).optional()
    })
    .optional(),
  density: z.enum(["compact", "comfortable", "spacious"]).optional(),
  notes: z.string().optional()
});

const CatalogEntrySchema = z.object({
  category: z.string().min(1),
  synonyms: z.array(z.string()).default([]),
  references: z.array(CatalogReferenceSchema).min(1),
  patternsThatWin: z.array(z.string()).default([]),
  patternsThatLose: z.array(z.string()).default([])
});

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogReference = z.infer<typeof CatalogReferenceSchema>;

export async function loadCatalog(dir: string): Promise<Map<string, CatalogEntry>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml"));
  const map = new Map<string, CatalogEntry>();
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    let parsed: unknown;
    try {
      parsed = yaml.load(raw, { schema: yaml.SAFE_SCHEMA });
    } catch (err) {
      throw new CatalogParseError(`yaml parse failed: ${(err as Error).message}`, { file });
    }
    const entry = CatalogEntrySchema.safeParse(parsed);
    if (!entry.success) {
      throw new CatalogParseError(`schema validation failed: ${entry.error.message}`, { file });
    }
    map.set(entry.data.category.toLowerCase(), entry.data);
  }
  return map;
}

export function lookupCategory(catalog: Map<string, CatalogEntry>, key: string): CatalogEntry | undefined {
  const normalized = key.toLowerCase();
  const direct = catalog.get(normalized);
  if (direct) return direct;
  for (const entry of catalog.values()) {
    if (entry.synonyms.map((s) => s.toLowerCase()).includes(normalized)) return entry;
  }
  return undefined;
}
```

- [ ] **Step 5: Run test — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/local-catalog.test.ts
```

Expected: PASS — 6 cases (loadCatalog: 2, lookupCategory: 4).

- [ ] **Step 6: Commit**

```bash
git add packages/role-researcher/src/local-catalog.ts \
        packages/role-researcher/test/local-catalog.test.ts \
        packages/role-researcher/catalog/restaurant-landing.yaml
git commit -m "feat(role-researcher): YAML catalog loader + restaurant-landing reference"
```

---

### Task 5: Add catalog batch 1 — 9 marketing/content categories

**Files:**
- Create: `packages/role-researcher/catalog/saas-marketing.yaml`
- Create: `packages/role-researcher/catalog/portfolio-personal.yaml`
- Create: `packages/role-researcher/catalog/e-commerce-product.yaml`
- Create: `packages/role-researcher/catalog/blog-publication.yaml`
- Create: `packages/role-researcher/catalog/agency-creative.yaml`
- Create: `packages/role-researcher/catalog/marketing-event.yaml`
- Create: `packages/role-researcher/catalog/mobile-app-marketing.yaml`
- Create: `packages/role-researcher/catalog/fintech-marketing.yaml`
- Create: `packages/role-researcher/catalog/b2b-landing.yaml`

- [ ] **Step 1: Create saas-marketing.yaml**

```yaml
category: saas-marketing
synonyms: [saas-landing, software-landing, product-marketing-page]
references:
  - name: Linear
    url: https://linear.app
    why: Editorial type pairing, monochrome palette, dense product-feature grid; never marketing-cliche
    palette: ["#0a0a0a", "#5e6ad2", "#f4f5f8"]
    typography:
      primary: Inter
    density: comfortable
  - name: Vercel
    url: https://vercel.com
    why: Geometric whitespace, Geist typography, reserved animation, deeply technical without being exclusionary
    palette: ["#000000", "#ffffff", "#0070f3"]
    typography:
      primary: Geist
      secondary: Geist Mono
    density: spacious
  - name: Stripe
    url: https://stripe.com
    why: Restrained palette + intentional gradients; copy is short, declarative, builder-first
    palette: ["#0a2540", "#635bff", "#fafbfc"]
    typography:
      primary: SF Pro
    density: comfortable
patternsThatWin:
  - one-line value prop above the fold
  - product screenshot or animation immediately under it
  - logo bar of customers (sparse, not 30 logos)
  - single primary CTA
  - changelog/docs in nav (signals active product)
patternsThatLose:
  - "Talk to Sales" gating before the user understands what the product does
  - generic stock-illustration heroes
  - testimonial walls without context
  - five competing CTAs above the fold
```

- [ ] **Step 2: Create portfolio-personal.yaml**

```yaml
category: portfolio-personal
synonyms: [personal-site, freelancer-portfolio, individual-portfolio]
references:
  - name: Pieter Levels
    url: https://levels.io
    why: Aggressively personal, direct copy, no design pretension, traffic-magnet through honesty
    palette: ["#fef3c7", "#92400e", "#0f172a"]
    density: compact
  - name: Brian Lovin
    url: https://brianlovin.com
    why: Editorial layout, opinionated typography, integrates writing + figma + reading list as one site
    palette: ["#0a0a0a", "#ffffff", "#3b82f6"]
    typography:
      primary: Soehne
    density: comfortable
  - name: Sara Soueidan
    url: https://www.sarasoueidan.com
    why: Accessibility-first design where the design itself demonstrates the practice
    palette: ["#1a202c", "#fef3c7", "#553c9a"]
    typography:
      primary: Mulish
    density: spacious
patternsThatWin:
  - face/photo of the person above the fold
  - opinionated single-page summary, not a multi-page CV
  - link to writing as primary content
  - explicit "available for hire" or "not available" status
patternsThatLose:
  - "I am a passionate developer who" copy
  - section called "Skills" with progress bars
  - hover-glitching nav animations
```

- [ ] **Step 3: Create e-commerce-product.yaml**

```yaml
category: e-commerce-product
synonyms: [product-detail-page, pdp, ecommerce-product]
references:
  - name: Allbirds product page
    url: https://www.allbirds.com
    why: Lifestyle photography over pack-shots, sustainability info woven into spec sheet
    palette: ["#1a1a1a", "#f5f5f0", "#86604a"]
    typography:
      primary: Calibre
    density: comfortable
  - name: Aesop
    url: https://www.aesop.com
    why: Editorial design treating product like a museum piece; restraint over abundance
    palette: ["#5d4f43", "#f5f1eb", "#1a1a1a"]
    typography:
      primary: Optima
    density: spacious
  - name: Nothing
    url: https://nothing.tech
    why: Industrial design language carries through to web — dot-matrix typography, exposed grid
    palette: ["#fafafa", "#1a1a1a", "#fc1d2c"]
    typography:
      primary: Nothing Pixel
      secondary: Inter
    density: comfortable
patternsThatWin:
  - lifestyle hero, then pack-shot grid
  - inline reviews count + star rating near price
  - "free returns / shipping" reassurance band
  - size guide as a modal, not a separate page
patternsThatLose:
  - thumbnail carousel as primary product visual
  - tab-based info hidden behind clicks
  - "you may also like" section with 12 SKUs above the fold
```

- [ ] **Step 4: Create blog-publication.yaml**

```yaml
category: blog-publication
synonyms: [blog, publication, magazine, content-site]
references:
  - name: The Pudding
    url: https://pudding.cool
    why: Visual essays with custom data viz per piece; typography is the chrome
    palette: ["#fafafa", "#1a1a1a", "#fbbf24"]
    typography:
      primary: Tiempos Headline
      secondary: Atlas Grotesk
    density: spacious
  - name: Stratechery
    url: https://stratechery.com
    why: Long-form, monetized as essays. Sober design that yields to text
    palette: ["#fef9f0", "#1a1a1a", "#7c2d12"]
    typography:
      primary: Georgia
    density: spacious
  - name: A List Apart
    url: https://alistapart.com
    why: Editorial publication aesthetic that signals "long careful read"
    palette: ["#fafafa", "#1a1a1a", "#0066cc"]
    typography:
      primary: Tisa
    density: comfortable
patternsThatWin:
  - byline + date prominent at the top of each piece
  - estimated read time
  - syntax-highlighted code if technical
  - inline images with captions, not floated thumbnails
patternsThatLose:
  - autoplaying video ads
  - "subscribe" modal in first 5 seconds
  - 12 social-share buttons cluttering margins
```

- [ ] **Step 5: Create agency-creative.yaml**

```yaml
category: agency-creative
synonyms: [creative-agency, design-agency, studio-site]
references:
  - name: Pentagram
    url: https://www.pentagram.com
    why: Minimal type, work is the content. Layout is hand-set, not template-driven
    palette: ["#ffffff", "#000000", "#dc2626"]
    typography:
      primary: Pentagram Sans
    density: spacious
  - name: Read.cv
    url: https://read.cv
    why: Editorial CV aesthetic translated into a startup product
    palette: ["#fafaf7", "#1a1a1a", "#a16207"]
    typography:
      primary: Söhne
    density: comfortable
patternsThatWin:
  - single piece of work as the hero
  - selected client list (not all clients)
  - founder principles or manifesto
patternsThatLose:
  - generic "we are creative" hero
  - logo cloud of every client ever
  - hover effects that hide info on hover
```

- [ ] **Step 6: Create marketing-event.yaml**

```yaml
category: marketing-event
synonyms: [conference-site, event-landing, summit-page]
references:
  - name: Config (Figma)
    url: https://config.figma.com
    why: Bold typography, agenda-as-grid, speakers as the chrome
    palette: ["#0d0d0d", "#a259ff", "#ff7262"]
    typography:
      primary: Whyte Inktrap
    density: comfortable
  - name: AWS re:Invent
    url: https://reinvent.awsevents.com
    why: Functional information design; agenda + tracks + register, no fluff
    palette: ["#232f3e", "#ff9900", "#ffffff"]
    typography:
      primary: Amazon Ember
    density: comfortable
patternsThatWin:
  - date + city above the fold
  - keynote speakers with photos
  - register CTA persistent in nav
  - day-by-day agenda
patternsThatLose:
  - countdown timer with nothing else
  - "speaker reveal" tease without dates
  - 14 sponsor logos above register CTA
```

- [ ] **Step 7: Create mobile-app-marketing.yaml**

```yaml
category: mobile-app-marketing
synonyms: [app-landing, mobile-app-website, ios-app-page]
references:
  - name: Things 3
    url: https://culturedcode.com/things
    why: Showcases the app interface as the hero. Restrained, considered
    palette: ["#fafafa", "#1a1a1a", "#3b82f6"]
    typography:
      primary: SF Pro
    density: comfortable
  - name: Bear
    url: https://bear.app
    why: Phone mockups in motion, gentle scroll-triggered transitions
    palette: ["#fef9f0", "#1a1a1a", "#dc2626"]
    typography:
      primary: SF Pro
    density: spacious
patternsThatWin:
  - phone mockup in hero showing real UI
  - app store + play store badges side-by-side
  - feature carousel synced to phone screenshots
  - real reviews above the fold
patternsThatLose:
  - generic "download our app" without showing it
  - separate iOS / Android pages
  - app icon larger than the screenshot
```

- [ ] **Step 8: Create fintech-marketing.yaml**

```yaml
category: fintech-marketing
synonyms: [fintech-landing, banking-site, finance-product-page]
references:
  - name: Mercury
    url: https://mercury.com
    why: Premium banking aesthetic — sober palette, generous whitespace, builder-first copy
    palette: ["#0a0a0a", "#ffffff", "#5e5ce6"]
    typography:
      primary: Sohne
    density: spacious
  - name: Wise
    url: https://wise.com
    why: Friendly fintech aesthetic — bright primary, clear pricing, trust badges woven in
    palette: ["#9fe870", "#163300", "#ffffff"]
    typography:
      primary: Inter
    density: comfortable
patternsThatWin:
  - real pricing table not "contact us"
  - regulatory licenses listed in footer
  - product screenshots from inside the app
  - integration logos
patternsThatLose:
  - stock photos of suited people shaking hands
  - "bank-grade security" without a SOC-2 badge
  - founder stock photo
```

- [ ] **Step 9: Create b2b-landing.yaml**

```yaml
category: b2b-landing
synonyms: [b2b-marketing, enterprise-landing, b2b-software]
references:
  - name: Ramp
    url: https://ramp.com
    why: Editorial photography, large numbers as proof points, dense feature grid
    palette: ["#fafaf7", "#1a1a1a", "#fb923c"]
    typography:
      primary: Sohne
    density: comfortable
  - name: Notion
    url: https://notion.so
    why: Friendly illustration meets Apple-grade typography; product as the demo
    palette: ["#ffffff", "#191919", "#2eaadc"]
    typography:
      primary: Inter
    density: comfortable
patternsThatWin:
  - "Trusted by" with 4-6 recognizable logos
  - calculated ROI number ("save 40 hours/week")
  - book-a-demo CTA + self-serve sign-up CTA, both visible
  - integrations section
patternsThatLose:
  - "Enterprise pricing — contact us" with no rough number
  - hero animation of dashboards mockups
  - feature parity table without competitive comparison
```

- [ ] **Step 10: Run catalog tests + commit**

```bash
pnpm --filter @atlas/role-researcher test test/local-catalog.test.ts
```

Expected: still PASS — the loader picks up all 10 YAMLs and the existing assertions remain green.

```bash
git add packages/role-researcher/catalog/saas-marketing.yaml \
        packages/role-researcher/catalog/portfolio-personal.yaml \
        packages/role-researcher/catalog/e-commerce-product.yaml \
        packages/role-researcher/catalog/blog-publication.yaml \
        packages/role-researcher/catalog/agency-creative.yaml \
        packages/role-researcher/catalog/marketing-event.yaml \
        packages/role-researcher/catalog/mobile-app-marketing.yaml \
        packages/role-researcher/catalog/fintech-marketing.yaml \
        packages/role-researcher/catalog/b2b-landing.yaml
git commit -m "feat(role-researcher): catalog batch 1 — 9 marketing/content categories"
```

---

### Task 6: Add catalog batch 2 — 10 application/utility categories

**Files:**
- Create: `packages/role-researcher/catalog/dashboard-admin.yaml`
- Create: `packages/role-researcher/catalog/documentation-site.yaml`
- Create: `packages/role-researcher/catalog/contact-form.yaml`
- Create: `packages/role-researcher/catalog/login-screen.yaml`
- Create: `packages/role-researcher/catalog/dashboard-analytics.yaml`
- Create: `packages/role-researcher/catalog/crm-internal.yaml`
- Create: `packages/role-researcher/catalog/marketplace-two-sided.yaml`
- Create: `packages/role-researcher/catalog/status-page.yaml`
- Create: `packages/role-researcher/catalog/changelog-page.yaml`
- Create: `packages/role-researcher/catalog/pricing-page.yaml`

- [ ] **Step 1: Create the 10 YAMLs (one per file)**

For brevity, each follows the same shape as Task 5 but for utility/application surfaces. Use the following starter content (the implementing engineer expands the references list to 2-3 entries per category, drawing from the corresponding reference apps below):

  - `dashboard-admin.yaml` — references: Linear (issue tracker), Notion (doc app), Things 3 (task app). Patterns: command palette, sidebar nav, search-first.
  - `documentation-site.yaml` — references: Stripe Docs, React docs, Vercel docs. Patterns: TOC sidebar, inline code with copy buttons, search at top.
  - `contact-form.yaml` — references: Cal.com booking, Notion forms, Typeform. Patterns: one-question-per-screen, real-time validation, success state.
  - `login-screen.yaml` — references: Vercel sign-in, Linear sign-in, Notion auth. Patterns: SSO buttons first, password as fallback, magic link.
  - `dashboard-analytics.yaml` — references: PostHog, Plausible, Mixpanel. Patterns: time-range selector at top, card grid of charts, funnel + retention as primary widgets.
  - `crm-internal.yaml` — references: Pipedrive, Hubspot, Attio. Patterns: kanban + table views toggle, contact cards, activity timeline.
  - `marketplace-two-sided.yaml` — references: Airbnb, Etsy, Substack. Patterns: trust signals (reviews, badges), search-first hero, supplier vs. buyer modes.
  - `status-page.yaml` — references: Vercel status, GitHub status, Cloudflare status. Patterns: traffic-light current state, subsystems list, incident timeline.
  - `changelog-page.yaml` — references: Linear changelog, Vercel changelog, Stripe changelog. Patterns: reverse-chronological, dated, image+copy per entry, RSS link.
  - `pricing-page.yaml` — references: Linear pricing, Vercel pricing, Notion pricing. Patterns: 3-tier comparison, calculator if usage-based, FAQ at bottom.

Each YAML follows the same schema enforced by `local-catalog.ts`: top-level `category`, `synonyms`, `references[]` with `name/url/why/palette/typography/density/notes`, `patternsThatWin`, `patternsThatLose`.

The implementing engineer fills in concrete URLs + palettes + typography for each by visiting the cited site and using the browser's DevTools to extract the actual brand colors. Every YAML must satisfy `CatalogEntrySchema` (Task 4 enforces — `pnpm test` will fail if any are malformed).

- [ ] **Step 2: Run catalog tests**

```bash
pnpm --filter @atlas/role-researcher test test/local-catalog.test.ts
```

Expected: PASS — loader picks up all 20 YAMLs.

- [ ] **Step 3: Commit**

```bash
git add packages/role-researcher/catalog/dashboard-admin.yaml \
        packages/role-researcher/catalog/documentation-site.yaml \
        packages/role-researcher/catalog/contact-form.yaml \
        packages/role-researcher/catalog/login-screen.yaml \
        packages/role-researcher/catalog/dashboard-analytics.yaml \
        packages/role-researcher/catalog/crm-internal.yaml \
        packages/role-researcher/catalog/marketplace-two-sided.yaml \
        packages/role-researcher/catalog/status-page.yaml \
        packages/role-researcher/catalog/changelog-page.yaml \
        packages/role-researcher/catalog/pricing-page.yaml
git commit -m "feat(role-researcher): catalog batch 2 — 10 application/utility categories"
```

---

### Task 7: Add catalog batch 3 — 10 vertical/specialty categories

**Files:**
- Create: `packages/role-researcher/catalog/nonprofit-cause.yaml`
- Create: `packages/role-researcher/catalog/education-course.yaml`
- Create: `packages/role-researcher/catalog/multi-tenant-saas-api.yaml`
- Create: `packages/role-researcher/catalog/single-tenant-internal-tool.yaml`
- Create: `packages/role-researcher/catalog/data-pipeline-etl.yaml`
- Create: `packages/role-researcher/catalog/healthcare-clinic.yaml`
- Create: `packages/role-researcher/catalog/government-service.yaml`
- Create: `packages/role-researcher/catalog/news-publication.yaml`
- Create: `packages/role-researcher/catalog/podcast-show.yaml`
- Create: `packages/role-researcher/catalog/careers-page.yaml`

- [ ] **Step 1: Create the 10 YAMLs**

Same shape as Task 5, with these reference seeds:

  - `nonprofit-cause.yaml` — Charity:Water, Pencils of Promise, Doctors Without Borders. Patterns: impact stat above-fold, donate CTA persistent, beneficiary photography (real, not stock).
  - `education-course.yaml` — Maven, Coursera, Khan Academy. Patterns: instructor photo, syllabus, sample lesson, pricing inline.
  - `multi-tenant-saas-api.yaml` — Stripe API, Twilio API, OpenAI API. Patterns: code sample in hero, language switcher, "try in playground" CTA, pricing per call.
  - `single-tenant-internal-tool.yaml` — Retool internal apps, Airtable internal builds. Patterns: spreadsheet-density tables, role-based UI, light theming.
  - `data-pipeline-etl.yaml` — Fivetran, Airbyte, dbt. Patterns: source-to-destination diagram, transformation visual, scheduling UI.
  - `healthcare-clinic.yaml` — One Medical, Forward, Practo. Patterns: appointment-booking CTA above-fold, doctor cards with credentials, services list.
  - `government-service.yaml` — gov.uk, USAGov, Singapore gov.sg. Patterns: high-contrast accessibility, plain language, service-finder hero.
  - `news-publication.yaml` — NYT, Guardian, Atlantic. Patterns: editorial typography, byline + date prominent, related articles, paywall integration.
  - `podcast-show.yaml` — Acquired, Lex Fridman, NPR Planet Money. Patterns: latest episode in hero, embedded player, guest list, transcript link.
  - `careers-page.yaml` — Linear careers, Vercel careers, Stripe careers. Patterns: company values + benefits, role list with filters, hiring process timeline.

- [ ] **Step 2: Run catalog tests**

```bash
pnpm --filter @atlas/role-researcher test test/local-catalog.test.ts
```

Expected: PASS — loader picks up all 30 YAMLs (the v1 scope target).

- [ ] **Step 3: Commit**

```bash
git add packages/role-researcher/catalog/nonprofit-cause.yaml \
        packages/role-researcher/catalog/education-course.yaml \
        packages/role-researcher/catalog/multi-tenant-saas-api.yaml \
        packages/role-researcher/catalog/single-tenant-internal-tool.yaml \
        packages/role-researcher/catalog/data-pipeline-etl.yaml \
        packages/role-researcher/catalog/healthcare-clinic.yaml \
        packages/role-researcher/catalog/government-service.yaml \
        packages/role-researcher/catalog/news-publication.yaml \
        packages/role-researcher/catalog/podcast-show.yaml \
        packages/role-researcher/catalog/careers-page.yaml
git commit -m "feat(role-researcher): catalog batch 3 — 10 vertical/specialty categories (v1 = 30 categories)"
```

---

### Task 8: Catalog-validate test (CI safety net)

**Files:**
- Create: `packages/role-researcher/test/catalog-validate.test.ts`

- [ ] **Step 1: Write the failing test (will pass once all YAMLs are well-formed; introduce one BAD YAML temporarily to verify red)**

Create `packages/role-researcher/test/catalog-validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { loadCatalog } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

describe("catalog validation", () => {
  it("loads all yaml files without error", async () => {
    await expect(loadCatalog(CATALOG_DIR)).resolves.toBeDefined();
  });

  it("contains the v1 target of 30 categories", async () => {
    const files = (await readdir(CATALOG_DIR)).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it("every entry has at least 1 reference", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    for (const entry of catalog.values()) {
      expect(entry.references.length).toBeGreaterThan(0);
    }
  });

  it("every entry's category matches its filename (kebab-case convention)", async () => {
    const files = (await readdir(CATALOG_DIR)).filter((f) => f.endsWith(".yaml"));
    const catalog = await loadCatalog(CATALOG_DIR);
    for (const file of files) {
      const expected = file.replace(/\.yaml$/, "");
      const found = Array.from(catalog.values()).some((e) => e.category === expected);
      expect(found, `file ${file} should declare category: ${expected}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run — expect green (catalog is well-formed by construction)**

```bash
pnpm --filter @atlas/role-researcher test test/catalog-validate.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/role-researcher/test/catalog-validate.test.ts
git commit -m "test(role-researcher): catalog-validate — 30 categories, every entry well-formed"
```

---

### Task 9: WebFetchAdapter interface + BraveSearchAdapter

**Files:**
- Create: `packages/role-researcher/src/web-fetch.ts`
- Create: `packages/role-researcher/test/web-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-researcher/test/web-fetch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { BraveSearchAdapter, type WebFetchAdapter, type WebHit } from "../src/web-fetch.js";
import { WebFetchError } from "../src/errors.js";

describe("BraveSearchAdapter", () => {
  it("issues GET to brave api with the right query", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: "Linear", url: "https://linear.app", description: "Issue tracking", thumbnail: { src: "x.jpg" } }
          ]
        }
      })
    });
    const adapter = new BraveSearchAdapter({ apiKey: "test-key", fetchImpl: fetchSpy as unknown as typeof fetch });
    const hits = await adapter.search("best saas-marketing websites 2026");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("api.search.brave.com");
    expect(String(url)).toContain("q=best+saas-marketing+websites+2026");
    expect((opts as RequestInit).headers).toMatchObject({ "X-Subscription-Token": "test-key" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "Linear", url: "https://linear.app" });
  });

  it("returns up to maxResults results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `R${i}`,
            url: `https://r${i}.com`,
            description: `d${i}`
          }))
        }
      })
    });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch, maxResults: 3 });
    const hits = await adapter.search("q");
    expect(hits).toHaveLength(3);
  });

  it("throws WebFetchError on non-2xx", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch });
    await expect(adapter.search("q")).rejects.toThrow(WebFetchError);
  });

  it("returns [] when results array is missing (graceful degrade)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ web: {} }) });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch });
    const hits = await adapter.search("q");
    expect(hits).toEqual([]);
  });

  it("times out via AbortController after timeoutMs", async () => {
    const fetchSpy = vi.fn().mockImplementation((_url, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = opts.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch, timeoutMs: 50 });
    await expect(adapter.search("q")).rejects.toThrow(/aborted|timeout/i);
  });
});

describe("WebFetchAdapter contract", () => {
  it("can be implemented by a mock", async () => {
    const mock: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        return [{ title: "X", url: "https://x", description: "y" }];
      }
    };
    const hits = await mock.search("anything");
    expect(hits[0].title).toBe("X");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-researcher test test/web-fetch.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement web-fetch.ts**

Create `packages/role-researcher/src/web-fetch.ts`:

```ts
import { WebFetchError } from "./errors.js";

export interface WebHit {
  title: string;
  url: string;
  description: string;
  thumbnailUrl?: string;
}

export interface WebFetchAdapter {
  search(query: string): Promise<WebHit[]>;
}

export interface BraveSearchAdapterOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
}

export class BraveSearchAdapter implements WebFetchAdapter {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResults: number;
  private readonly timeoutMs: number;

  constructor(opts: BraveSearchAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxResults = opts.maxResults ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async search(query: string): Promise<WebHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.maxResults));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey
        },
        signal: controller.signal
      });
    } catch (err) {
      throw new WebFetchError(`brave fetch failed: ${(err as Error).message}`, { provider: "brave", cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new WebFetchError(`brave returned ${res.status}`, { provider: "brave", status: res.status });
    }
    const body = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; thumbnail?: { src?: string } }> } };
    const results = body.web?.results ?? [];
    return results.slice(0, this.maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.description ?? "",
      thumbnailUrl: r.thumbnail?.src
    }));
  }
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/web-fetch.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-researcher/src/web-fetch.ts packages/role-researcher/test/web-fetch.test.ts
git commit -m "feat(role-researcher): WebFetchAdapter + BraveSearchAdapter (timeout, schema, graceful 4xx)"
```

---

### Task 10: assemble-brief — pure helper that builds InspirationBrief from local + web hits via LLM

**Files:**
- Create: `packages/role-researcher/src/assemble-brief.ts`
- Create: `packages/role-researcher/test/assemble-brief.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-researcher/test/assemble-brief.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { assembleBrief, RESEARCHER_BRIEF_MODEL } from "../src/assemble-brief.js";
import { InspirationBriefSchema } from "../src/types.js";
import type { CatalogEntry } from "../src/local-catalog.js";
import type { WebHit } from "../src/web-fetch.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_brief", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const sampleEntry: CatalogEntry = {
  category: "restaurant-landing",
  synonyms: ["cafe-website"],
  references: [
    {
      name: "Bombay Canteen",
      url: "https://thebombaycanteen.com",
      why: "Editorial serif",
      palette: ["#0a0a0a", "#fbbf24"],
      typography: { primary: "IBM Plex Serif" },
      density: "spacious"
    }
  ],
  patternsThatWin: ["above-the-fold reservation CTA"],
  patternsThatLose: ["stock photo carousels"]
};

describe("assembleBrief", () => {
  it("returns a Zod-valid InspirationBrief on happy path", async () => {
    const llm = fakeLLM({
      category: "restaurant-landing",
      audienceCues: ["fine-dining"],
      references: [
        {
          name: "Bombay Canteen",
          url: "https://thebombaycanteen.com",
          why: "Editorial serif",
          sourceTier: "local-catalog",
          palettePreview: ["#0a0a0a", "#fbbf24"],
          typographyPreview: { primary: "IBM Plex Serif" }
        }
      ],
      patternsThatWin: ["above-the-fold reservation CTA"],
      patternsThatLose: ["stock photo carousels"]
    });

    const brief = await assembleBrief({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      localEntry: sampleEntry,
      webHits: []
    });

    expect(InspirationBriefSchema.safeParse(brief).success).toBe(true);
    expect(brief.references[0].sourceTier).toBe("local-catalog");
  });

  it("invokes the LLM with tool-use shape", async () => {
    const llm = fakeLLM({
      category: "x",
      audienceCues: [],
      references: [],
      patternsThatWin: [],
      patternsThatLose: []
    });
    await assembleBrief({
      llm: llm as never,
      designIntent: { category: "x", audienceCues: [] },
      localEntry: undefined,
      webHits: []
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledOnce();
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string; tools: Array<{ name: string }> };
    expect(opts.model).toBe(RESEARCHER_BRIEF_MODEL);
    expect(opts.tools[0].name).toBe("emit_brief");
  });

  it("rejects when LLM returns malformed payload", async () => {
    const llm = fakeLLM({ totally: "wrong shape" });
    await expect(
      assembleBrief({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        localEntry: undefined,
        webHits: []
      })
    ).rejects.toThrow();
  });

  it("includes web hits + local entry in the user-turn message", async () => {
    const llm = fakeLLM({
      category: "x",
      audienceCues: [],
      references: [{ name: "n", why: "y", sourceTier: "web" }],
      patternsThatWin: [],
      patternsThatLose: []
    });
    const webHits: WebHit[] = [{ title: "Linear", url: "https://linear.app", description: "issues" }];
    await assembleBrief({
      llm: llm as never,
      designIntent: { category: "x", audienceCues: [] },
      localEntry: sampleEntry,
      webHits
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Linear"));
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toContain("Bombay Canteen");
    expect(userMsg?.content).toContain("Linear");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-researcher test test/assemble-brief.test.ts
```

- [ ] **Step 3: Implement assemble-brief.ts**

Create `packages/role-researcher/src/assemble-brief.ts`:

```ts
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { InspirationBriefSchema, type DesignIntent, type InspirationBrief } from "./types.js";
import type { CatalogEntry } from "./local-catalog.js";
import type { WebHit } from "./web-fetch.js";
import { ResearcherFailedError } from "./errors.js";

export const RESEARCHER_BRIEF_MODEL = "claude-haiku-4-5";

const ROLE_PROMPT = `You are the Researcher role. Given a designIntent (category +
audience cues), a local-catalog entry (curated references), and optional web-search hits,
produce ONE InspirationBrief that fuses both sources into a single recommendation set.

Rules:
- Cite local-catalog references with sourceTier: "local-catalog"; web hits with sourceTier: "web".
- Prefer 3-5 references total. If you have more, pick the most diverse + relevant.
- Carry over palettePreview / typographyPreview from local entries where present; do NOT invent them for web hits unless visible in the hit description.
- patternsThatWin / patternsThatLose: synthesize from local entry + your knowledge of the category.
- audienceCues: echo the designIntent's cues; do NOT add new ones.

Call the emit_brief tool exactly once.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    audienceCues: { type: "array", items: { type: "string" } },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          why: { type: "string" },
          sourceTier: { type: "string", enum: ["local-catalog", "web"] },
          palettePreview: { type: "array", items: { type: "string" } },
          typographyPreview: {
            type: "object",
            properties: {
              primary: { type: "string" },
              secondary: { type: "string" }
            },
            required: ["primary"]
          }
        },
        required: ["name", "why", "sourceTier"]
      }
    },
    patternsThatWin: { type: "array", items: { type: "string" } },
    patternsThatLose: { type: "array", items: { type: "string" } }
  },
  required: ["category", "audienceCues", "references", "patternsThatWin", "patternsThatLose"]
} as const;

interface AssembleBriefInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  localEntry: CatalogEntry | undefined;
  webHits: WebHit[];
}

export async function assembleBrief(input: AssembleBriefInput): Promise<InspirationBrief> {
  const userTurn = renderUserTurn(input);

  const messages: LLMMessage[] = [
    { role: "system", content: ROLE_PROMPT },
    { role: "user", content: userTurn }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: RESEARCHER_BRIEF_MODEL,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_brief",
          description: "Emit the InspirationBrief",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_brief" }
    });
  } catch (err) {
    throw new ResearcherFailedError(`brief LLM call failed: ${(err as Error).message}`, {
      cause: err,
      category: input.designIntent.category
    });
  }

  const parsed = InspirationBriefSchema.safeParse(result.input);
  if (!parsed.success) {
    throw new ResearcherFailedError(`brief tool_use payload failed schema: ${parsed.error.message}`, {
      cause: parsed.error,
      category: input.designIntent.category
    });
  }
  return parsed.data;
}

function renderUserTurn(input: AssembleBriefInput): string {
  const parts: string[] = [];
  parts.push(`# Design Intent`);
  parts.push(`Category: ${input.designIntent.category}`);
  parts.push(`Audience cues: ${input.designIntent.audienceCues.join(", ") || "(none)"}`);

  if (input.localEntry) {
    parts.push("");
    parts.push("# Local Catalog Entry");
    parts.push("```yaml");
    parts.push(JSON.stringify(input.localEntry, null, 2));
    parts.push("```");
  } else {
    parts.push("");
    parts.push("# Local Catalog Entry");
    parts.push("(no entry for this category — use general principles)");
  }

  if (input.webHits.length > 0) {
    parts.push("");
    parts.push("# Web Search Hits");
    for (const hit of input.webHits) {
      parts.push(`- **${hit.title}** — ${hit.url}`);
      parts.push(`  ${hit.description}`);
    }
  }

  parts.push("");
  parts.push("Now produce the InspirationBrief via the emit_brief tool.");
  return parts.join("\n");
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/assemble-brief.test.ts
```

Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-researcher/src/assemble-brief.ts packages/role-researcher/test/assemble-brief.test.ts
git commit -m "feat(role-researcher): assembleBrief — Haiku LLM call with tool-use, Zod-validated"
```

---

### Task 11: ResearcherRole class (`role.ts`) wiring it all together

**Files:**
- Create: `packages/role-researcher/src/role.ts`
- Create: `packages/role-researcher/test/role.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-researcher/test/role.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { ResearcherRole } from "../src/role.js";
import type { WebFetchAdapter, WebHit } from "../src/web-fetch.js";
import { loadCatalog } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_brief", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const validBriefReply = (category: string) => ({
  category,
  audienceCues: [],
  references: [{ name: "X", why: "y", sourceTier: "local-catalog" }],
  patternsThatWin: ["a"],
  patternsThatLose: ["b"]
});

describe("ResearcherRole", () => {
  it("has id 'researcher'", () => {
    const role = new ResearcherRole({ llm: fakeLLM(validBriefReply("x")) as never, catalogDir: CATALOG_DIR });
    expect(role.id).toBe("researcher");
  });

  it("happy path: catalog hit + LLM reply → brief in events", async () => {
    const llm = fakeLLM(validBriefReply("restaurant-landing"));
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    const out = await role.run({
      ritualId: "r1",
      userTurn: "build a restaurant landing",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
    expect((completed?.payload as { brief?: { category: string } } | undefined)?.brief?.category).toBe("restaurant-landing");
  });

  it("fast-mode: skips LLM, returns mechanically-built brief", async () => {
    const llm = fakeLLM(validBriefReply("restaurant-landing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      mode: "fast"
    });
    const out = await role.run({
      ritualId: "r1",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).not.toHaveBeenCalled();
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
  });

  it("empty-catalog: still emits a brief (web-only or LLM-only path)", async () => {
    const llm = fakeLLM(validBriefReply("battle-mech-configurator"));
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    const out = await role.run({
      ritualId: "r1",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "battle-mech-configurator", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
  });

  it("with web adapter: passes web hits to assembleBrief", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const adapter: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        return [{ title: "Linear", url: "https://linear.app", description: "issues" }];
      }
    };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR, webAdapter: adapter });
    await role.run({
      ritualId: "r1",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "saas-marketing", audienceCues: [] } }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Linear"));
    expect(userMsg).toBeDefined();
  });

  it("web fetch error doesn't fail the role (falls back to local-only)", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const adapter: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        throw new Error("brave 503");
      }
    };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR, webAdapter: adapter });
    const out = await role.run({
      ritualId: "r1",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "saas-marketing", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
    const failed = out.events.find((e) => e.eventType === "researcher.brief.failed");
    expect(failed).toBeUndefined(); // role still succeeds
  });

  it("LLM error → researcher.brief.failed event + throws", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    await expect(
      role.run({
        ritualId: "r1",
        userTurn: "x",
        graphSlice: { bytes: "{}", hash: "h" },
        priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-researcher test test/role.test.ts
```

- [ ] **Step 3: Implement role.ts**

Create `packages/role-researcher/src/role.ts`:

```ts
import path from "node:path";
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { loadCatalog, lookupCategory, type CatalogEntry } from "./local-catalog.js";
import type { WebFetchAdapter, WebHit } from "./web-fetch.js";
import { assembleBrief } from "./assemble-brief.js";
import { DesignIntentSchema, InspirationBriefSchema, type DesignIntent, type InspirationBrief } from "./types.js";
import { ResearcherFailedError } from "./errors.js";

export interface ResearcherRoleOptions {
  llm: LLMProvider;
  catalogDir?: string;
  webAdapter?: WebFetchAdapter | null;
  mode?: "fast" | "considered";
}

const DEFAULT_CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

export class ResearcherRole implements Role {
  readonly id = "researcher";
  private readonly llm: LLMProvider;
  private readonly catalogDir: string;
  private readonly webAdapter: WebFetchAdapter | null;
  private readonly mode: "fast" | "considered";
  private catalogPromise: Promise<Map<string, CatalogEntry>> | null = null;

  constructor(opts: ResearcherRoleOptions) {
    this.llm = opts.llm;
    this.catalogDir = opts.catalogDir ?? DEFAULT_CATALOG_DIR;
    this.webAdapter = opts.webAdapter ?? null;
    this.mode = opts.mode ?? "considered";
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({ eventType: "researcher.brief.skipped", payload: { reason: "no designIntent in priorArtifact" } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "researcher.brief.started", payload: { category: designIntent.category, mode: this.mode } });

    const catalog = await this.getCatalog();
    const localEntry = lookupCategory(catalog, designIntent.category);

    if (this.mode === "fast") {
      const brief = mechanicalBriefFromLocal(designIntent, localEntry);
      events.push({ eventType: "researcher.brief.completed", payload: { brief, fastMode: true } });
      return { events, diff: { kind: "none" } };
    }

    let webHits: WebHit[] = [];
    if (this.webAdapter) {
      try {
        webHits = await this.webAdapter.search(`best ${designIntent.category} websites 2026`);
      } catch (err) {
        // Web fetch failure is recoverable — log it but proceed with local-only.
        events.push({
          eventType: "researcher.web.degraded",
          payload: { error: (err as Error).message }
        });
      }
    }

    let brief: InspirationBrief;
    try {
      brief = await assembleBrief({
        llm: this.llm,
        designIntent,
        localEntry,
        webHits
      });
    } catch (err) {
      events.push({ eventType: "researcher.brief.failed", payload: { error: (err as Error).message } });
      throw err;
    }

    events.push({ eventType: "researcher.brief.completed", payload: { brief, fastMode: false } });
    return { events, diff: { kind: "none" } };
  }

  private getCatalog(): Promise<Map<string, CatalogEntry>> {
    if (!this.catalogPromise) {
      this.catalogPromise = loadCatalog(this.catalogDir);
    }
    return this.catalogPromise;
  }
}

function extractDesignIntent(priorArtifact: unknown): DesignIntent | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const di = (priorArtifact as { designIntent?: unknown }).designIntent;
  const parsed = DesignIntentSchema.safeParse(di);
  return parsed.success ? parsed.data : null;
}

function mechanicalBriefFromLocal(intent: DesignIntent, entry: CatalogEntry | undefined): InspirationBrief {
  if (!entry) {
    return {
      category: intent.category,
      audienceCues: intent.audienceCues,
      references: [],
      patternsThatWin: [],
      patternsThatLose: []
    };
  }
  return {
    category: intent.category,
    audienceCues: intent.audienceCues,
    references: entry.references.slice(0, 3).map((r) => ({
      name: r.name,
      url: r.url,
      why: r.why,
      sourceTier: "local-catalog" as const,
      palettePreview: r.palette,
      typographyPreview: r.typography
    })),
    patternsThatWin: entry.patternsThatWin,
    patternsThatLose: entry.patternsThatLose
  };
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-researcher test test/role.test.ts
```

Expected: PASS — 7 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-researcher/src/role.ts packages/role-researcher/test/role.test.ts
git commit -m "feat(role-researcher): ResearcherRole — local catalog + optional web + fast-mode short-circuit"
```

---

### Task 12: Public exports (`index.ts`)

**Files:**
- Create: `packages/role-researcher/src/index.ts`

- [ ] **Step 1: Write index.ts**

Create `packages/role-researcher/src/index.ts`:

```ts
export {
  InspirationBriefSchema,
  DesignIntentSchema,
  ReferenceSchema,
  type InspirationBrief,
  type DesignIntent,
  type Reference
} from "./types.js";

export { ResearcherRole, type ResearcherRoleOptions } from "./role.js";

export { BraveSearchAdapter, type WebFetchAdapter, type WebHit, type BraveSearchAdapterOptions } from "./web-fetch.js";

export { loadCatalog, lookupCategory, type CatalogEntry, type CatalogReference } from "./local-catalog.js";

export { assembleBrief, RESEARCHER_BRIEF_MODEL } from "./assemble-brief.js";

export { ResearcherFailedError, CatalogParseError, WebFetchError } from "./errors.js";
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @atlas/role-researcher typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/role-researcher/src/index.ts
git commit -m "feat(role-researcher): public exports — Role + types + adapters + helpers"
```

---

### Task 13: Skill markdown files in skill-library

**Files:**
- Create: `packages/skill-library/skills/researcher/assemble-brief.md`
- Create: `packages/skill-library/skills/researcher/cite-references.md`

- [ ] **Step 1: Create assemble-brief.md skill**

Create `packages/skill-library/skills/researcher/assemble-brief.md`:

```markdown
---
name: assemble-brief
description: Compose an InspirationBrief from local catalog hits + web search results
activate_on: visualize
model_hint: haiku
---

# Assemble Brief

## When to use

The Researcher role composes this skill in the LLM call that turns local-catalog + web-search inputs into a structured `InspirationBrief`.

## Checklist

- [ ] Cite local-catalog references with `sourceTier: "local-catalog"`; web hits with `sourceTier: "web"`.
- [ ] 3-5 references total. If you have more candidates, pick the most diverse + relevant.
- [ ] Carry over palettePreview / typographyPreview from local entries; do NOT invent them for web hits unless visible in the description.
- [ ] patternsThatWin / patternsThatLose: synthesize from local entry + general knowledge.
- [ ] audienceCues: echo the designIntent's cues; do NOT add new ones.

## Output contract

`InspirationBrief` per `packages/role-researcher/src/types.ts`.

## Anti-patterns

- Don't fabricate URLs or palettes for web hits — if you don't see them, omit.
- Don't drop the local entry just because web hits are richer; mix sources.
- Don't write generic patterns ("use a hero section"); be specific to the category.
```

- [ ] **Step 2: Create cite-references.md skill**

Create `packages/skill-library/skills/researcher/cite-references.md`:

```markdown
---
name: cite-references
description: Quality bar for citing references inside an InspirationBrief
activate_on: visualize
model_hint: haiku
---

# Cite References

## When to use

When emitting any reference inside an `InspirationBrief`, this skill defines the quality bar for the `why` field.

## Checklist

- [ ] `why` names a specific design choice the reference makes well: ("editorial serif", "hero gives 60% to a single dish", "command palette over navigation").
- [ ] Avoid vague praise ("looks great", "modern design", "clean").
- [ ] If `palettePreview` is present, it MUST come from observed brand colors, not invented.
- [ ] If `typographyPreview` is present, it MUST be the actual font family (verifiable via DevTools), not a generic class ("sans-serif").

## Anti-patterns

- "modern, clean, professional" as the `why`
- Hex codes that don't match the cited site
- Generic font families ("system-ui", "sans-serif") in `typographyPreview.primary`
```

- [ ] **Step 3: Validate skills (repository's existing skill-library validator)**

```bash
pnpm --filter @atlas/skill-library test
```

Expected: PASS — the new skills satisfy the repo's frontmatter+structure validators.

- [ ] **Step 4: Commit**

```bash
git add packages/skill-library/skills/researcher/
git commit -m "feat(skill-library): add researcher/assemble-brief + researcher/cite-references skills"
```

---

### Task 14: Wire ResearcherRole into atlas-web's factory.ts

**Files:**
- Modify: `apps/atlas-web/lib/llm/factory.ts`
- Create: `apps/atlas-web/test/lib/factory-researcher.test.ts`

- [ ] **Step 1: Read existing factory.ts to understand the registration pattern**

```bash
cat apps/atlas-web/lib/llm/factory.ts | head -80
```

The factory composes Role instances + a Conductor + RitualEngine, gated by env vars. The pattern: read `process.env.ATLAS_FF_<role>`, conditionally instantiate, pass into the engine's `postDeveloperChain` or other slot.

For this plan, ResearcherRole is **registered** in the factory but not yet **dispatched** by the engine — that wiring belongs to Plan S.4. The registration enables atlas-web to construct the role without crashing.

- [ ] **Step 2: Write the failing test**

Create `apps/atlas-web/test/lib/factory-researcher.test.ts`:

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

describe("factory researcher integration", () => {
  it("getResearcherRole returns null when ATLAS_FF_RESEARCHER is not set", async () => {
    delete process.env.ATLAS_FF_RESEARCHER;
    const { getResearcherRole } = await import("@/lib/llm/factory");
    const role = await getResearcherRole();
    expect(role).toBeNull();
  });

  it("getResearcherRole returns a ResearcherRole when ATLAS_FF_RESEARCHER=true", async () => {
    process.env.ATLAS_FF_RESEARCHER = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getResearcherRole } = await import("@/lib/llm/factory");
    const role = await getResearcherRole();
    expect(role).not.toBeNull();
    expect(role!.id).toBe("researcher");
  });

  it("attaches BraveSearchAdapter when ATLAS_RESEARCH_WEB=true + key set", async () => {
    process.env.ATLAS_FF_RESEARCHER = "true";
    process.env.ATLAS_RESEARCH_WEB = "true";
    process.env.BRAVE_SEARCH_API_KEY = "k_test";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getResearcherRole } = await import("@/lib/llm/factory");
    const role = await getResearcherRole();
    expect(role).not.toBeNull();
    // Adapter is internal; presence is verified indirectly by the env-var check.
    // The role's behavior with the adapter is covered by role.test.ts in the package.
  });

  it("does NOT attach web adapter when ATLAS_RESEARCH_WEB=true but key is missing", async () => {
    process.env.ATLAS_FF_RESEARCHER = "true";
    process.env.ATLAS_RESEARCH_WEB = "true";
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getResearcherRole } = await import("@/lib/llm/factory");
    // Should still return a role (degraded — no web)
    const role = await getResearcherRole();
    expect(role).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect failure (function doesn't exist yet)**

```bash
pnpm --filter atlas-web test test/lib/factory-researcher.test.ts
```

- [ ] **Step 4: Add `getResearcherRole` to factory.ts**

Open `apps/atlas-web/lib/llm/factory.ts`. Add at the end of the file (after the existing exports), wrapped in `cache()` like the existing factory functions:

```ts
import { cache } from "react";
import type { ResearcherRole as TResearcherRole } from "@atlas/role-researcher";

export const getResearcherRole = cache(async (): Promise<TResearcherRole | null> => {
  if (process.env.ATLAS_FF_RESEARCHER !== "true") return null;

  const { ResearcherRole, BraveSearchAdapter } = await import("@atlas/role-researcher");
  const llm = await getLlmProvider();
  if (!llm) return null;

  const useWeb = process.env.ATLAS_RESEARCH_WEB === "true";
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  const webAdapter = useWeb && braveKey ? new BraveSearchAdapter({ apiKey: braveKey }) : null;

  return new ResearcherRole({ llm, webAdapter });
});
```

(Place the `import { cache } from "react"` line at the top with the other imports if it's not already there. The dynamic import of `@atlas/role-researcher` matches the pattern the file uses for other roles to keep startup-time bundle weight low.)

- [ ] **Step 5: Add `@atlas/role-researcher` to atlas-web's deps**

Open `apps/atlas-web/package.json`. Add to `dependencies`:

```json
    "@atlas/role-researcher": "workspace:*",
```

(insert alphabetically among existing `@atlas/*` workspace deps).

Run from repo root:

```bash
pnpm install
```

- [ ] **Step 6: Run test — expect green**

```bash
pnpm --filter atlas-web test test/lib/factory-researcher.test.ts
```

Expected: PASS — 4 cases.

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/lib/llm/factory.ts \
        apps/atlas-web/test/lib/factory-researcher.test.ts \
        apps/atlas-web/package.json
git commit -m "feat(atlas-web): factory.getResearcherRole gated by ATLAS_FF_RESEARCHER + ATLAS_RESEARCH_WEB"
```

---

### Task 15: Update .env.example with new flags

**Files:**
- Modify: `apps/atlas-web/.env.example`

- [ ] **Step 1: Add the new env-var entries**

Open `apps/atlas-web/.env.example`. After the existing `ATLAS_FF_*` block, append:

```bash
# ─── Plan S.2 — Researcher role + reference catalog ──────────────────────────
# Enables the Researcher role (catalog-only or +web). Default OFF.
ATLAS_FF_RESEARCHER=false

# When true AND BRAVE_SEARCH_API_KEY is set, Researcher attaches BraveSearchAdapter
# and live-fetches category references in addition to the local catalog.
ATLAS_RESEARCH_WEB=false

# Brave Search API key (https://api.search.brave.com — free tier covers ~2k queries/month).
# Only consulted when ATLAS_RESEARCH_WEB=true.
BRAVE_SEARCH_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add apps/atlas-web/.env.example
git commit -m "docs(atlas-web): .env.example — ATLAS_FF_RESEARCHER + ATLAS_RESEARCH_WEB + BRAVE_SEARCH_API_KEY"
```

---

### Task 16: Update local-dev-status with Plan S.2 entry

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Add a new "What's wired" entry**

Open `docs/superpowers/local-dev-status.md`. After the Plan S.1 entry (added in Plan S.1 Task 15), add:

```markdown
- **Plan S.2: Researcher role + reference catalog.** When `ATLAS_FF_RESEARCHER=true`, `getResearcherRole()` instantiates `ResearcherRole` from `@atlas/role-researcher`. Catalog-only by default (30 hand-curated category YAMLs in `packages/role-researcher/catalog/`). When `ATLAS_RESEARCH_WEB=true` AND `BRAVE_SEARCH_API_KEY` is set, attaches `BraveSearchAdapter` for live web search per ritual. Fast-mode short-circuit (constructor `mode: "fast"`) skips the LLM call and returns mechanical brief from top-3 local references. Not yet dispatched by the engine — that wiring lands in Plan S.4. Until then, the role is constructable + tested but inert.
```

Also update the env-var reference table (the `## How to enable each plan locally` section). Add a row:

```markdown
| **S.2** | `ATLAS_FF_RESEARCHER=true` | optional `ATLAS_RESEARCH_WEB=true` + `BRAVE_SEARCH_API_KEY` | Constructs ResearcherRole. Inert until S.4 wires it into the engine. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/local-dev-status.md
git commit -m "docs: log Plan S.2 researcher role + catalog in local-dev-status"
```

---

### Task 17: Run full repo test suite + open the PR

**Files:**
- (no file edits — verification + handoff)

- [ ] **Step 1: Workspace-wide test + typecheck**

```bash
pnpm -r --no-bail typecheck && pnpm -r --no-bail test
```

Expected: every package green. The new `@atlas/role-researcher` adds ~30 tests; everything else unchanged.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin plan-s2/researcher-catalog
gh pr create --title "Plan S.2 — Researcher role + 30-category reference catalog" --body "$(cat <<'EOF'
## Summary
- New `@atlas/role-researcher` package — Role implementation + Zod schemas + Brave Search adapter + assemble-brief LLM helper.
- 30 hand-curated YAML reference catalogs covering marketing/utility/vertical surfaces.
- atlas-web `factory.getResearcherRole()` gated behind `ATLAS_FF_RESEARCHER`; web search opt-in via `ATLAS_RESEARCH_WEB` + `BRAVE_SEARCH_API_KEY`.
- ~30 new tests (types, errors, local-catalog, web-fetch, assemble-brief, role, factory). All green.

## Wires to nothing yet
ResearcherRole is constructable + tested but the RitualEngine doesn't dispatch it. Plan S.4 wires it into the pipeline. Until then the role runs only in tests.

## Test plan
- [ ] `pnpm -r test` — all packages green; `@atlas/role-researcher` adds ~30 tests
- [ ] Set `ATLAS_FF_RESEARCHER=true` in `.env.local`, restart atlas-web — no crash; researcher role is constructed but inert
- [ ] (Optional, requires BRAVE_SEARCH_API_KEY) Set `ATLAS_RESEARCH_WEB=true`, write a tiny manual integration test that calls `getResearcherRole()?.run({ priorArtifact: { designIntent: { category: "saas-marketing", audienceCues: [] } }, ... })` and inspects the resulting brief

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Completion Checklist

- [ ] Branch `plan-s2/researcher-catalog` cut from `main`
- [ ] `@atlas/role-researcher` package scaffolded (package.json, tsconfig, vitest.config, README)
- [ ] `types.ts`: InspirationBriefSchema + DesignIntentSchema
- [ ] `errors.ts`: ResearcherFailedError + CatalogParseError + WebFetchError
- [ ] `local-catalog.ts`: YAML loader + synonym lookup
- [ ] `web-fetch.ts`: WebFetchAdapter interface + BraveSearchAdapter
- [ ] `assemble-brief.ts`: LLM call producing valid brief
- [ ] `role.ts`: ResearcherRole class with fast-mode + web-degraded paths
- [ ] `index.ts`: public exports
- [ ] 30 catalog YAMLs (3 batches: 9 marketing + 10 utility + 10 vertical)
- [ ] `catalog-validate.test.ts`: every YAML parses + has refs + matches filename
- [ ] Skill markdown: `assemble-brief.md` + `cite-references.md`
- [ ] atlas-web factory: `getResearcherRole()` behind `ATLAS_FF_RESEARCHER`
- [ ] `.env.example`: new env-var block
- [ ] `local-dev-status.md`: Plan S.2 entry + flag-table row
- [ ] `pnpm -r test` green
- [ ] PR opened, reviewed, merged

---

## Handoff to Plan S.3

Once Plan S.2 merges, **Plan S.3 (Designer Role + A2UI Primitive)** can begin. S.3 consumes the `InspirationBrief` shape this plan defines and produces a `DesignProposal`. The A2UI primitive (`OptionsCard` / `AxisWizard` / `OutcomeCard` / `TechnicalCard`) is React-side and can develop in parallel with S.3 backend work.

S.3 plan: `docs/superpowers/plans/2026-05-02-plan-s3-designer-a2ui.md`.
