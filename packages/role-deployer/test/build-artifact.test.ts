import { describe, it, expect } from "vitest";
import { buildDeployArtifact } from "../src/build-artifact.js";

describe("buildDeployArtifact", () => {
  it("assembles a valid DeployArtifact from LLM output", () => {
    const a = buildDeployArtifact({
      argoApplication: { file: "argo/app.yaml", name: "proj-1", repoUrl: "git@example.com:proj.git", path: "k8s/", content: "kind: Application" },
      imageBuilds: [{ serviceName: "api", dockerfilePath: "Dockerfile.api", imageTag: "registry/proj/api:sha-1" }],
      smokeTests: [{ url: "/health", expectStatus: 200 }]
    });
    expect(a.kind).toBe("deploy");
    expect(a.target).toBe("k8s");
    expect(a.argoApplication.name).toBe("proj-1");
    expect(a.imageBuilds).toHaveLength(1);
  });
  it("accepts empty imageBuilds and smokeTests", () => {
    const a = buildDeployArtifact({
      argoApplication: { file: "x", name: "x", repoUrl: "x", path: "x", content: "x" },
      imageBuilds: [], smokeTests: []
    });
    expect(a.imageBuilds).toEqual([]);
    expect(a.smokeTests).toEqual([]);
  });
});
