import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { IacArtifactSchema, type IacService, type IacK8sManifest } from "@atlas/workflow-engine";
import { buildIacArtifact } from "./build-artifact.js";
import { iacRubric } from "./rubric.js";

export interface SandboxLike {
  exec(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write(path: string, contents: string): Promise<void>;
}

export interface IacRoleOptions {
  sandbox?: SandboxLike;
  generateIac: (input: { services: ReadonlyArray<IacService>; ritualId: string }) =>
    Promise<{ composeYaml: string; k8sManifests: ReadonlyArray<IacK8sManifest> }>;
  imageRegistry?: { url: string; namespace: string };
}

const RUNTIME_KINDS = new Set(["backend-rest-api", "frontend-app", "backend-graphql"]);

export class IacRole implements Role {
  readonly id = "iac";
  readonly rubric = iacRubric;
  constructor(private readonly opts: IacRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};
    const services: IacService[] = [];
    for (const [nodeId, raw] of Object.entries(upstream)) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as { kind?: unknown; envContract?: unknown };
      if (typeof a.kind !== "string" || !RUNTIME_KINDS.has(a.kind)) continue;
      const envContract = Array.isArray(a.envContract)
        ? (a.envContract.filter((e): e is { name: string; required: boolean; description?: string } =>
            !!e && typeof e === "object" && typeof (e as { name: unknown }).name === "string"
              && typeof (e as { required: unknown }).required === "boolean") as IacService["envContract"])
        : [];
      const port = a.kind === "backend-rest-api" ? 8000 : a.kind === "backend-graphql" ? 4000 : 3000;
      services.push({
        name: nodeId.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
        runtimeNodeId: nodeId,
        artifactKind: a.kind,
        port,
        envContract
      });
    }

    if (services.length === 0) {
      events.push({ eventType: "iac.failed", payload: { reason: "no upstream runtime nodes to deploy" } });
      return { events, diff: { kind: "none" } };
    }

    let generated: { composeYaml: string; k8sManifests: ReadonlyArray<IacK8sManifest> };
    try {
      generated = await this.opts.generateIac({ services, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "iac.failed", payload: { reason: `LLM gen failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    if (this.opts.sandbox) {
      try {
        await this.opts.sandbox.write("docker-compose.yml", generated.composeYaml);
        await this.opts.sandbox.exec("docker compose -f docker-compose.yml config");
      } catch {
        // Lint is advisory — best-effort only.
      }
    }

    const artifact = buildIacArtifact({
      composeYaml: generated.composeYaml,
      k8sManifests: generated.k8sManifests,
      services,
      imageRegistry: this.opts.imageRegistry ?? { url: "registry.atlas.local/projects", namespace: "default" }
    });

    const parsed = IacArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "iac.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "iac", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
