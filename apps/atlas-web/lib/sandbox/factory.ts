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
import type { SandboxSession } from "./types.js";

interface SandboxFactoryConfig {
  lifecycle: SandboxLifecycle;
  spendReader: SpendReader;
  spendCapConfig: SpendCapConfig;
  defaultTemplate: TemplateId;
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

  private async doProvision(projectId: string): Promise<SandboxSession> {
    await checkSpendCap(projectId, this.config.spendReader, this.config.spendCapConfig);
    const record = await this.config.lifecycle.provision(
      this.config.defaultTemplate,
      projectId
    );
    const defaultPort = TEMPLATE_DEFAULT_PORTS[this.config.defaultTemplate];
    // For the factory, derive preview URL from the sandbox record's previewBaseUrl
    // (set by E2BLifecycle.provision via E2B's getHost) or fall back to a placeholder.
    const previewUrl = record.previewBaseUrl ?? `https://${defaultPort}-${record.sandboxId}.e2b.app`;
    return { record, previewUrl };
  }
}

const TEMPLATE_DEFAULT_PORTS: Record<TemplateId, number> = {
  "atlas-next-ts": 3000,
  "atlas-python-fastapi": 8000,
  "atlas-react-vite": 5173,
  "atlas-astro": 4321,
  "atlas-sveltekit": 5173,
  "atlas-expo": 8081
};

// Module-level singletons — Next.js server-side; constructed lazily on first import.
let _factory: SandboxFactory | null = null;
let _spendPool: pg.Pool | null = null;

function getSpendReader(): SpendReader {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // No DB configured (e.g., local `next build` without env) → cap never triggers.
    return {
      getAccumulatedSpend: async () => 0,
      getRollingAverageSpend: async () => 0,
    };
  }
  if (!_spendPool) {
    _spendPool = new pg.Pool({ connectionString: url });
  }
  return new SandboxSpendRepo(_spendPool);
}

export function getSandboxFactory(): SandboxFactory {
  if (!_factory) {
    _factory = new SandboxFactory({
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
      }),
      spendReader: getSpendReader(),
      spendCapConfig: {
        capUsd: Number(process.env.SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH ?? "50"),
        warnMultiplier: 3,
      },
      defaultTemplate: "atlas-next-ts",
    });
  }
  return _factory;
}
