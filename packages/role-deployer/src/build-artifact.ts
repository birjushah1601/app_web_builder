import type { DeployArtifact, DeployArgoApplication, DeployImageBuild, DeploySmokeTest } from "@atlas/workflow-engine";

export interface BuildDeployArtifactInput {
  argoApplication: DeployArgoApplication;
  imageBuilds: ReadonlyArray<DeployImageBuild>;
  smokeTests: ReadonlyArray<DeploySmokeTest>;
}

export function buildDeployArtifact(input: BuildDeployArtifactInput): DeployArtifact {
  return {
    schemaVersion: "1",
    kind: "deploy",
    target: "k8s",
    argoApplication: { ...input.argoApplication },
    imageBuilds: [...input.imageBuilds],
    smokeTests: [...input.smokeTests]
  };
}
