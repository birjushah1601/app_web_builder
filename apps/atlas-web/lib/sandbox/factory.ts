import {
  E2BLifecycle,
  checkSpendCap,
  SandboxIdSchema,
  type SandboxLifecycle,
  type SpendReader,
  type SpendCapConfig,
  type TemplateId,
} from "@atlas/sandbox-e2b";
import { SandboxSpendRepo } from "@atlas/spec-graph-data";
import pg from "pg";
import type { SandboxSession } from "./types";
import { templateForArtifactKind, portForTemplate } from "./template-router";
import type { ArtifactKind } from "@atlas/canvas-runtime";

interface SandboxFactoryConfig {
  lifecycle: SandboxLifecycle;
  spendReader: SpendReader;
  spendCapConfig: SpendCapConfig;
  defaultTemplate: TemplateId;
  /** Port the running app inside the sandbox listens on (Next: 3000, FastAPI: 8000, …). */
  defaultPort?: number;
}

export class SandboxFactory {
  private readonly config: SandboxFactoryConfig;
  /** projectId → SandboxSession */
  private readonly sessions = new Map<string, SandboxSession>();
  /** In-flight provision promises — prevents race when two requests hit simultaneously */
  private readonly inflight = new Map<string, Promise<SandboxSession>>();

  constructor(config: SandboxFactoryConfig) {
    this.config = config;
  }

  async getOrProvision(projectId: string): Promise<SandboxSession> {
    const cached = this.sessions.get(projectId);
    if (cached) return cached;

    // Coalesce concurrent calls for the same projectId
    const existing = this.inflight.get(projectId);
    if (existing) return existing;

    const promise = this.doProvision(projectId);
    this.inflight.set(projectId, promise);
    try {
      const session = await promise;
      this.sessions.set(projectId, session);
      return session;
    } finally {
      this.inflight.delete(projectId);
    }
  }

  async terminate(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) return;
    const sandboxId = SandboxIdSchema.parse(session.record.sandboxId);
    await this.config.lifecycle.terminate(sandboxId);
    this.sessions.delete(projectId);
  }

  /** Drop the in-memory cache entry for a project without trying to terminate
   *  the underlying sandbox. Call this when a downstream Sandbox.connect()
   *  call throws "paused / not found" — E2B has already collected the
   *  sandbox, so the next getOrProvision() will allocate a fresh one. */
  evict(projectId: string): void {
    this.sessions.delete(projectId);
  }

  private async doProvision(projectId: string): Promise<SandboxSession> {
    await checkSpendCap(projectId, this.config.spendReader, this.config.spendCapConfig);
    const record = await this.config.lifecycle.provision(
      this.config.defaultTemplate,
      projectId
    );
    // Port resolution precedence:
    //   1. SandboxFactoryConfig.defaultPort (env-configured at factory init)
    //   2. portForTemplate(template) — authoritative per-template map shared
    //      with the router. Bun trio (atlas-bun-cli/graphql-yoga/hono-bun) →
    //      3001; Next/FastAPI/dlt/Expo → 3000.
    //   3. Hard-coded TEMPLATE_DEFAULT_PORTS map for legacy aspirational names.
    //   4. 3000 (Next.js — the most common case).
    // For the factory, derive preview URL from the sandbox record's previewBaseUrl
    // (set by E2BLifecycle.provision via E2B's getHost) or fall back to a placeholder.
    const port =
      this.config.defaultPort ??
      portForTemplate(record.templateId) ??
      TEMPLATE_DEFAULT_PORTS[record.templateId as keyof typeof TEMPLATE_DEFAULT_PORTS] ??
      3000;
    const previewUrl = record.previewBaseUrl ?? `https://${port}-${record.sandboxId}.e2b.app`;
    return { record, previewUrl };
  }
}

/**
 * Legacy aspirational-name port map. New entries should be added to
 * `portForTemplate` in template-router.ts instead — this map only exists to
 * keep the original KNOWN_ATLAS_TEMPLATES (atlas-python-fastapi, atlas-astro,
 * etc.) working if anyone has them pinned. The actually-built atlas-* names
 * (atlas-next-ts-v2, atlas-fastapi, atlas-bun-cli, …) are owned by
 * `portForTemplate`.
 */
const TEMPLATE_DEFAULT_PORTS: Record<TemplateId, number> = {
  "atlas-next-ts": 3000,
  "atlas-python-fastapi": 8000,
  "atlas-react-vite": 5173,
  "atlas-astro": 4321,
  "atlas-sveltekit": 5173,
  "atlas-expo": 8081
};

// Pin singletons to globalThis. Next.js dev gives Server Actions and Server
// Components separate module graphs, so a plain module-level `let _factory`
// would fork into two factory instances — one for Server Actions like
// redeployPreview, one for the canvas page's Server Component. evict() in
// one would not invalidate the other's cache, leaving the canvas page
// pointing at a dead sandbox even after a successful redeploy. Same pattern
// as broker-singleton.ts and canvas-pause-singleton.ts.
const FACTORY_KEY = "__atlas_sandbox_factory__";
const SPEND_POOL_KEY = "__atlas_sandbox_spend_pool__";
type WithSingletons = {
  [FACTORY_KEY]?: SandboxFactory;
  [SPEND_POOL_KEY]?: pg.Pool;
};

function getSpendPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const g = globalThis as unknown as WithSingletons;
  if (!g[SPEND_POOL_KEY]) {
    g[SPEND_POOL_KEY] = new pg.Pool({ connectionString: url });
  }
  return g[SPEND_POOL_KEY];
}

function getSpendReader(): SpendReader {
  const pool = getSpendPool();
  if (!pool) {
    // No DB configured (e.g., local `next build` without env) → cap never triggers.
    return {
      getAccumulatedSpend: async () => 0,
      getRollingAverageSpend: async () => 0,
    };
  }
  return new SandboxSpendRepo(pool);
}

function getSpendRecorder(): SandboxSpendRepo | undefined {
  const pool = getSpendPool();
  return pool ? new SandboxSpendRepo(pool) : undefined;
}

export function getSandboxFactory(): SandboxFactory {
  const g = globalThis as unknown as WithSingletons;
  if (!g[FACTORY_KEY]) {
    // Allow operators to point at any E2B template they actually have on
    // their account — including raw template IDs (alphanumeric, e.g.
    // "6f5mwsacoiiqt0qj1bgx") — without forking this file. The atlas-*
    // names listed in @atlas/sandbox-e2b's KNOWN_ATLAS_TEMPLATES are
    // aspirational; the codebase doesn't ship the Dockerfiles for them,
    // so a real deployment must either build them or set
    // ATLAS_DEFAULT_SANDBOX_TEMPLATE to an existing template ID.
    const defaultTemplate: TemplateId = process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE ?? "atlas-next-ts";
    const defaultPort = process.env.ATLAS_DEFAULT_SANDBOX_PORT
      ? Number(process.env.ATLAS_DEFAULT_SANDBOX_PORT)
      : undefined;

    g[FACTORY_KEY] = new SandboxFactory({
      lifecycle: new E2BLifecycle({
        apiKey: process.env.E2B_API_KEY ?? "",
        templateDigests: {
          "atlas-next-ts": process.env.E2B_TEMPLATE_NEXT_TS_DIGEST ?? "",
          "atlas-python-fastapi": process.env.E2B_TEMPLATE_PYTHON_FASTAPI_DIGEST ?? "",
          "atlas-react-vite": process.env.E2B_TEMPLATE_REACT_VITE_DIGEST ?? "",
          "atlas-astro": process.env.E2B_TEMPLATE_ASTRO_DIGEST ?? "",
          "atlas-sveltekit": process.env.E2B_TEMPLATE_SVELTEKIT_DIGEST ?? "",
          "atlas-expo": process.env.E2B_TEMPLATE_EXPO_DIGEST ?? "",
        },
        spendRecorder: getSpendRecorder(),
        hourlyRateUsd: process.env.SANDBOX_HOURLY_RATE_USD
          ? Number(process.env.SANDBOX_HOURLY_RATE_USD)
          : undefined,
      }),
      spendReader: getSpendReader(),
      spendCapConfig: {
        capUsd: Number(process.env.SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH ?? "50"),
        warnMultiplier: 3,
      },
      defaultTemplate,
      defaultPort,
    });
  }
  return g[FACTORY_KEY];
}

/** Test-only — drops the singleton so subsequent getSandboxFactory() calls re-read env. */
export function _resetSandboxFactoryForTests(): void {
  const g = globalThis as unknown as WithSingletons;
  g[FACTORY_KEY] = undefined;
}

/**
 * Plan T.1 — decide which E2B template to provision for a ritual.
 *
 * Precedence (highest first):
 *   1. process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE (per-project pin)
 *   2. templateForArtifactKind(artifactKind) when ATLAS_FF_MULTI_STACK=true
 *   3. "atlas-next-ts-v2" default
 */
export function resolveTemplateForRitual(input: { artifactKind?: ArtifactKind }): string {
  const pinned = process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE;
  if (pinned) return pinned;
  const multiStackOn = process.env.ATLAS_FF_MULTI_STACK === "true";
  return templateForArtifactKind(input.artifactKind, { multiStackFlagOn: multiStackOn });
}
