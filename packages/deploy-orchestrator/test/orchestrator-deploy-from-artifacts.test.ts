import { describe, it, expect } from "vitest";
import { DeployOrchestrator } from "../src/orchestrator.js";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import type { IacArtifact, DeployArtifact } from "@atlas/workflow-engine";

const IAC: IacArtifact = {
  schemaVersion: "1",
  kind: "iac",
  compose: { file: "docker-compose.yml", content: "version: '3'" },
  k8s: {
    manifests: [
      {
        file: "k8s/svc.yaml",
        kind: "Service",
        name: "api",
        content:
          "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\nspec: {}"
      }
    ]
  },
  services: [],
  imageRegistry: { url: "reg.local", namespace: "proj-1" }
};

const DEPLOY: DeployArtifact = {
  schemaVersion: "1",
  kind: "deploy",
  target: "k8s",
  argoApplication: {
    file: "argo/app.yaml",
    name: "proj-main",
    repoUrl: "git@x:y.git",
    path: "k8s/",
    content:
      "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-main\nspec: {}"
  },
  imageBuilds: [],
  smokeTests: []
};

describe("DeployOrchestrator.deployFromArtifacts", () => {
  it("delegates to runDeployFromArtifacts with the orchestrator's wired deps", async () => {
    const kubernetes = new InMemoryKubernetesClient();
    const cloudflare = new InMemoryCloudflareClient();
    kubernetes.setHealth("proj-main", "Healthy");

    const orchestrator = new DeployOrchestrator({
      kubernetes,
      cloudflare,
      branching: {
        ensureBranch: async (_p: string, b: string) => ({ created: true, schemaName: `branch_${b}` }),
        dropBranch: async (_p: string, b: string) => ({ schemaName: `branch_${b}`, dropped: true }),
        listBranches: async () => []
      },
      migrate: async () => ({ schemaName: "branch_main", applied: 0, filenames: [] }),
      manifestRepoUrl: "git@example.com:manifests.git",
      issuerRef: "letsencrypt-prod",
      ingressTarget: "ingress.example.com",
      reconcileIntervalMs: 1,
      reconcileTimeoutMs: 50
    });

    const result = await orchestrator.deployFromArtifacts({
      projectId: "p-1",
      branchId: "main",
      subdomain: "proj-1",
      apex: "atlas.dev",
      iacArtifact: IAC,
      deployArtifact: DEPLOY
    });

    expect(result.phase).toBe("healthy");
    expect(result.publicUrl).toBe("https://proj-1.atlas.dev");
    expect(result.argoApplicationName).toBe("proj-main");
    expect(result.appliedManifests.length).toBeGreaterThan(0);
  });
});
