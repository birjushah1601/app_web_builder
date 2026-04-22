import { describe, it, expect } from "vitest";
import { DeployOrchestrator } from "../src/orchestrator.js";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";

const branchingStub = {
  ensureBranch: async (_p: string, _b: string) => ({ schemaName: "br_abcdef0123456789", created: true }),
  dropBranch: async () => ({ schemaName: "br_x", dropped: true }),
  listBranches: async () => []
};
const migrateStub = async () => ({ schemaName: "br_abcdef0123456789", applied: 6, filenames: [] });

describe("DeployOrchestrator.deploy — happy path", () => {
  it("emits manifests, applies them, returns DeployResult with phase=healthy", async () => {
    const k8s = new InMemoryKubernetesClient();
    const cf = new InMemoryCloudflareClient();
    const orch = new DeployOrchestrator({
      kubernetes: k8s,
      cloudflare: cf,
      branching: branchingStub,
      migrate: migrateStub,
      manifestRepoUrl: "https://gitea.atlas.app/atlas/deployments.git",
      issuerRef: "letsencrypt-cloudflare-dns01",
      ingressTarget: "k8s-ingress.atlas.app",
      reconcileIntervalMs: 5
    });

    const result = await orch.deploy({
      projectId: "11111111-1111-4111-8111-111111111111",
      branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production",
      subdomain: "abc",
      apex: "atlas.app",
      env: {}
    });

    expect(result.phase).toBe("healthy");
    expect(result.publicUrl).toBe("https://abc.atlas.app");
    expect(result.argoApplicationName).toBe("p-abc-main");
    expect(result.branchSchemaName).toBe("br_abcdef0123456789");

    expect(k8s.get("argocd", "Application", "p-abc-main")).toBeDefined();
    expect(k8s.get("atlas-projects", "Service", "p-abc-main")).toBeDefined();
    expect(k8s.get("atlas-projects", "Certificate", "cert-abc-main")).toBeDefined();
    expect(cf.list("atlas.app")).toContainEqual({
      name: "abc.atlas.app",
      type: "CNAME",
      content: "k8s-ingress.atlas.app"
    });
  });

  it("injects SENTRY_DSN into Knative env when glitchTipDsnFor returns a value", async () => {
    const k8s = new InMemoryKubernetesClient();
    const cf = new InMemoryCloudflareClient();
    const orch = new DeployOrchestrator({
      kubernetes: k8s,
      cloudflare: cf,
      branching: branchingStub,
      migrate: migrateStub,
      manifestRepoUrl: "x",
      issuerRef: "x",
      ingressTarget: "x",
      reconcileIntervalMs: 5,
      glitchTipDsnFor: () => "https://abc@glitchtip.atlas.app/1"
    });
    await orch.deploy({
      projectId: "11111111-1111-4111-8111-111111111111",
      branchId: "main",
      imageRef: "x@sha256:" + "0".repeat(64),
      target: "production",
      subdomain: "abc",
      apex: "atlas.app",
      env: {}
    });
    const knativeYaml = k8s.get("atlas-projects", "Service", "p-abc-main") ?? "";
    expect(knativeYaml).toContain("SENTRY_DSN");
    expect(knativeYaml).toContain("glitchtip.atlas.app");
  });
});
