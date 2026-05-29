import type { IacArtifact, IacService, IacK8sManifest } from "@atlas/workflow-engine";

export interface BuildIacArtifactInput {
  composeYaml: string;
  composeFile?: string;
  k8sManifests: ReadonlyArray<IacK8sManifest>;
  services: ReadonlyArray<IacService>;
  imageRegistry: { url: string; namespace: string };
}

export function buildIacArtifact(input: BuildIacArtifactInput): IacArtifact {
  return {
    schemaVersion: "1",
    kind: "iac",
    compose: {
      file: input.composeFile ?? "docker-compose.yml",
      content: input.composeYaml
    },
    k8s: { manifests: [...input.k8sManifests] },
    services: [...input.services],
    imageRegistry: input.imageRegistry
  };
}
