import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { DeployArtifactSchema, type DeployArgoApplication, type DeployImageBuild, type DeploySmokeTest, type IacArtifact } from "@atlas/workflow-engine";
import { buildDeployArtifact } from "./build-artifact.js";
import { deployerRubric } from "./rubric.js";

export interface DeployerRoleOptions {
  generateDeploy: (input: { iac: IacArtifact; ritualId: string }) =>
    Promise<{
      argoApplication: DeployArgoApplication;
      imageBuilds: ReadonlyArray<DeployImageBuild>;
      smokeTests: ReadonlyArray<DeploySmokeTest>;
    }>;
}

export class DeployerRole implements Role {
  readonly id = "deployer";
  readonly rubric = deployerRubric;
  constructor(private readonly opts: DeployerRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};
    let iac: IacArtifact | undefined;
    for (const raw of Object.values(upstream)) {
      if (raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "iac") {
        iac = raw as IacArtifact;
        break;
      }
    }

    if (!iac) {
      events.push({ eventType: "deployer.failed", payload: { reason: "missing upstream iac artifact" } });
      return { events, diff: { kind: "none" } };
    }

    let generated: { argoApplication: DeployArgoApplication; imageBuilds: ReadonlyArray<DeployImageBuild>; smokeTests: ReadonlyArray<DeploySmokeTest> };
    try {
      generated = await this.opts.generateDeploy({ iac, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "deployer.failed", payload: { reason: `LLM gen failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    const artifact = buildDeployArtifact(generated);
    const parsed = DeployArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "deployer.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "deployer", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
