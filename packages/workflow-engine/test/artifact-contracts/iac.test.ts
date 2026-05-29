import { describe, it, expect } from "vitest";
import { IacArtifactSchema } from "../../src/artifact-contracts/iac.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/registry.js";
import "../../src/artifact-contracts/iac.js";

describe("IacArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "iac" as const,
    compose: { file: "docker-compose.yml", content: "version: '3'\nservices: {}" },
    k8s: {
      manifests: [
        { file: "k8s/api.yaml", kind: "Service", name: "api", content: "apiVersion: v1\nkind: Service" }
      ]
    },
    services: [
      { name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000, envContract: [] }
    ],
    imageRegistry: { url: "registry.atlas.local/projects", namespace: "proj-1" }
  };
  it("accepts a minimal valid artifact", () => {
    expect(IacArtifactSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects wrong kind literal", () => {
    expect(IacArtifactSchema.safeParse({ ...valid, kind: "deploy" }).success).toBe(false);
  });
  it("accepts services with optional port omitted", () => {
    const { port: _drop, ...firstWithoutPort } = valid.services[0];
    const noPort = { ...valid, services: [firstWithoutPort] };
    expect(IacArtifactSchema.safeParse(noPort).success).toBe(true);
  });
  it("rejects services with negative port", () => {
    const bad = { ...valid, services: [{ ...valid.services[0], port: -1 }] };
    expect(IacArtifactSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts empty manifests array", () => {
    expect(IacArtifactSchema.safeParse({ ...valid, k8s: { manifests: [] } }).success).toBe(true);
  });
  it("is registered under 'iac' kind", () => {
    expect(ArtifactContractRegistry.has("iac")).toBe(true);
  });
});
