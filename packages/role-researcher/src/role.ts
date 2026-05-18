import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { loadCatalog, lookupCategory, type CatalogEntry } from "./local-catalog.js";
import type { WebFetchAdapter, WebHit } from "./web-fetch.js";
import { assembleBrief } from "./assemble-brief.js";
import { DesignIntentSchema, type DesignIntent, type InspirationBrief } from "./types.js";

export interface ResearcherRoleOptions {
  llm: LLMProvider;
  catalogDir?: string;
  webAdapter?: WebFetchAdapter | null;
  mode?: "fast" | "considered";
  /** Plan T.1 — skill markdown root used to look up per-`artifactKind`
   *  brief fragments (`assemble-brief-${artifactKind}.md`). Optional;
   *  when unset or the file is missing the role falls back to the
   *  generic `assemble-brief` skill. */
  skillsDir?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CATALOG_DIR = path.resolve(__dirname, "..", "catalog");
const GENERIC_BRIEF_SKILL = "assemble-brief";

export class ResearcherRole implements Role {
  readonly id = "researcher";
  private readonly llm: LLMProvider;
  private readonly catalogDir: string;
  private readonly webAdapter: WebFetchAdapter | null;
  private readonly mode: "fast" | "considered";
  private readonly skillsDir: string | null;
  private catalogPromise: Promise<Map<string, CatalogEntry>> | null = null;

  constructor(opts: ResearcherRoleOptions) {
    this.llm = opts.llm;
    this.catalogDir = opts.catalogDir ?? DEFAULT_CATALOG_DIR;
    this.webAdapter = opts.webAdapter ?? null;
    this.mode = opts.mode ?? "considered";
    this.skillsDir = opts.skillsDir ?? null;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({ eventType: "researcher.brief.skipped", payload: { reason: "no designIntent in priorArtifact" } });
      return { events, diff: { kind: "none" } };
    }

    const composedSkillNames = this.composeSkillNames(designIntent);
    events.push({
      eventType: "researcher.skills.composed",
      payload: { skills: composedSkillNames, artifactKind: designIntent.artifactKind ?? null }
    });

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

  /** Plan T.1 — prepend `assemble-brief-${artifactKind}` when a per-kind
   *  skill markdown exists on disk, otherwise compose with the generic
   *  `assemble-brief` only. The on-disk check (a) is best-effort: when no
   *  `skillsDir` is configured we just emit the generic skill (the existing
   *  S.2 behavior). When the per-kind file is missing we fall back to the
   *  generic skill alone. */
  private composeSkillNames(designIntent: DesignIntent): string[] {
    const names = [GENERIC_BRIEF_SKILL];
    const kind = designIntent.artifactKind;
    if (!kind || !this.skillsDir) return names;

    const perKind = `${GENERIC_BRIEF_SKILL}-${kind}`;
    const candidate = path.join(this.skillsDir, `${perKind}.md`);
    try {
      if (fs.existsSync(candidate)) {
        return [perKind, ...names];
      }
    } catch {
      // existsSync rarely throws, but treat any I/O hiccup as "missing" so
      // the role keeps running with the generic fragment.
    }
    return names;
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
