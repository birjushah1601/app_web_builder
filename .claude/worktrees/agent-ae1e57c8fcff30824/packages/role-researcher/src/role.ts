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
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
