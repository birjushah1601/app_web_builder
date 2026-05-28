import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { buildBackendArtifact } from "./build-artifact.js";
import { BackendArtifactSchema } from "@atlas/workflow-engine";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface BackendArtifactRoleOptions {
  /** Injected so tests don't hit the network. Defaults to global fetch. */
  fetcher?: Fetcher;
  readinessTimeoutMs?: number; // default 30000
  readinessPollMs?: number;    // default 500
}

interface PriorShape {
  sandboxId?: unknown;
  previewUrl?: unknown;
  envContract?: unknown;
  dbDdl?: unknown;
}

export class BackendArtifactRole implements Role {
  readonly id = "backend-artifact";
  private readonly fetcher: Fetcher;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;

  constructor(opts: BackendArtifactRoleOptions = {}) {
    this.fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
    this.readinessTimeoutMs = opts.readinessTimeoutMs ?? 30_000;
    this.readinessPollMs = opts.readinessPollMs ?? 500;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const prior = (inv.priorArtifact ?? {}) as PriorShape;
    const sandboxId = typeof prior.sandboxId === "string" ? prior.sandboxId : undefined;
    const previewUrl = typeof prior.previewUrl === "string" ? prior.previewUrl : undefined;
    const envContract = Array.isArray(prior.envContract) ? (prior.envContract as never) : [];
    const dbDdl = typeof prior.dbDdl === "string" ? prior.dbDdl : undefined;

    if (!sandboxId || !previewUrl) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: "missing sandboxId or previewUrl in priorArtifact" }
      });
      return { events, diff: { kind: "none" } };
    }

    // Wait for /health.
    const deadline = Date.now() + this.readinessTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await this.fetcher(`${previewUrl}/health`);
        if (res.ok) { ready = true; break; }
      } catch {
        // network blip — retry
      }
      await new Promise((r) => setTimeout(r, this.readinessPollMs));
    }
    if (!ready) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `/health never returned 200 within ${this.readinessTimeoutMs}ms` }
      });
      return { events, diff: { kind: "none" } };
    }

    // Fetch the OpenAPI spec.
    let openApiSpec: Record<string, unknown>;
    try {
      const res = await this.fetcher(`${previewUrl}/openapi.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      openApiSpec = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `openapi.json fetch failed: ${err instanceof Error ? err.message : String(err)}` }
      });
      return { events, diff: { kind: "none" } };
    }

    // Build + validate.
    const artifact = buildBackendArtifact({
      openApiSpec,
      envContract,
      sandboxId,
      previewUrl,
      ...(dbDdl && { dbDdl })
    });
    const parsed = BackendArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({
        eventType: "backend-artifact.failed",
        payload: { reason: `artifact failed schema validation: ${parsed.error.message}` }
      });
      return { events, diff: { kind: "none" } };
    }

    events.push({
      eventType: "ritual.artifact_emitted",
      payload: { fromRole: "backend-artifact", artifact: parsed.data }
    });
    return { events, diff: { kind: "none" } };
  }
}
