export const ATLAS_ATTRS = {
  PROJECT_ID: "atlas.project_id",
  ROLE_ID: "atlas.role_id",
  RITUAL_ID: "atlas.ritual_id",
  GATE_LAYER: "atlas.gate_layer",
  BRANCH_ID: "atlas.branch_id",
  DEPLOY_TARGET: "atlas.deploy_target",
  LLM_PROVIDER: "atlas.llm.provider",
  LLM_MODEL: "atlas.llm.model",
  SKILL_NAME: "atlas.skill.name"
} as const;

export interface ResourceAttributesInput {
  serviceName: string;
  serviceVersion: string;
  deployTarget: "production" | "preview";
}

export function buildAtlasResourceAttributes(
  input: ResourceAttributesInput
): Record<string, string> {
  if (!input.serviceName) throw new Error("serviceName must be non-empty");
  return {
    "service.name": input.serviceName,
    "service.version": input.serviceVersion,
    [ATLAS_ATTRS.DEPLOY_TARGET]: input.deployTarget
  };
}
