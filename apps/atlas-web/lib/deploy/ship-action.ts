import type { DeployOrchestrator, DeployRequest } from "@atlas/deploy-orchestrator";

export interface ShipActionInput {
  orchestrator: DeployOrchestrator;
  projectId: string;
  subdomain: string;
  apex: string;
  branchId: string;
  imageRef: string;
  target: DeployRequest["target"];
}

export type ShipActionResult =
  | { ok: true; publicUrl: string; deployId: string }
  | { ok: false; error: string };

export async function performShipAction(input: ShipActionInput): Promise<ShipActionResult> {
  try {
    const result = await input.orchestrator.deploy({
      projectId: input.projectId,
      branchId: input.branchId,
      imageRef: input.imageRef,
      target: input.target,
      subdomain: input.subdomain,
      apex: input.apex,
      env: {}
    });
    return { ok: true, publicUrl: result.publicUrl ?? "", deployId: result.deployId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
