import { describe, it, expect } from "vitest";
import { DeployArtifactSchema } from "../../src/artifact-contracts/deploy.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/registry.js";
import "../../src/artifact-contracts/deploy.js";

describe("DeployArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "deploy" as const,
    target: "k8s" as const,
    argoApplication: { file: "argo/app.yaml", content: "kind: Application", name: "proj-1", repoUrl: "git@x.com:y.git", path: "k8s/" },
    imageBuilds: [{ serviceName: "api", dockerfilePath: "Dockerfile.api", imageTag: "reg/proj/api:sha-1" }],
    smokeTests: [{ url: "/health", expectStatus: 200 }]
  };
  it("accepts a minimal valid artifact", () => {
    expect(DeployArtifactSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects wrong target literal", () => {
    expect(DeployArtifactSchema.safeParse({ ...valid, target: "compose" }).success).toBe(false);
  });
  it("rejects smokeTest with expectStatus < 100", () => {
    const bad = { ...valid, smokeTests: [{ url: "/x", expectStatus: 99 }] };
    expect(DeployArtifactSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects smokeTest with expectStatus > 599", () => {
    const bad = { ...valid, smokeTests: [{ url: "/x", expectStatus: 600 }] };
    expect(DeployArtifactSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts smokeTest with optional expectBodyContains", () => {
    const ok = { ...valid, smokeTests: [{ url: "/x", expectStatus: 200, expectBodyContains: "ok" }] };
    expect(DeployArtifactSchema.safeParse(ok).success).toBe(true);
  });
  it("accepts empty imageBuilds", () => {
    expect(DeployArtifactSchema.safeParse({ ...valid, imageBuilds: [] }).success).toBe(true);
  });
  it("is registered under 'deploy' kind", () => {
    expect(ArtifactContractRegistry.has("deploy")).toBe(true);
  });
});
