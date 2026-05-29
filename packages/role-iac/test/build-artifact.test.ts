import { describe, it, expect } from "vitest";
import { buildIacArtifact } from "../src/build-artifact.js";

const COMPOSE = "version: '3'\nservices:\n  api:\n    image: registry.atlas.local/proj-1/api:latest";
const K8S_API = "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\nspec: {}";

describe("buildIacArtifact", () => {
  it("assembles a valid IacArtifact from LLM output", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE,
      k8sManifests: [{ file: "k8s/api.yaml", kind: "Knative Service", name: "api", content: K8S_API }],
      services: [{ name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000, envContract: [] }],
      imageRegistry: { url: "registry.atlas.local/projects", namespace: "proj-1" }
    });
    expect(a.kind).toBe("iac");
    expect(a.compose.content).toContain("api");
    expect(a.k8s.manifests).toHaveLength(1);
    expect(a.services[0]?.name).toBe("api");
  });
  it("threads envContract through verbatim", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE, k8sManifests: [],
      services: [{
        name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000,
        envContract: [{ name: "DATABASE_URL", required: true, description: "Postgres" }]
      }],
      imageRegistry: { url: "x", namespace: "y" }
    });
    expect(a.services[0]?.envContract).toHaveLength(1);
  });
  it("accepts services with no port", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE, k8sManifests: [],
      services: [{ name: "worker", runtimeNodeId: "n", artifactKind: "x", envContract: [] }],
      imageRegistry: { url: "x", namespace: "y" }
    });
    expect(a.services[0]?.port).toBeUndefined();
  });
});
