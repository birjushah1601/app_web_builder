import { describe, it, expect } from "vitest";
import { DeployOrchestrator } from "../src/orchestrator.js";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { DeployError } from "../src/errors.js";

const branchingStub = {
  ensureBranch: async () => ({ schemaName: "br_x", created: true }),
  dropBranch: async () => ({ schemaName: "br_x", dropped: true }),
  listBranches: async () => []
};
const migrateStub = async () => ({ schemaName: "br_x", applied: 0, filenames: [] });

describe("DeployOrchestrator.deploy — Argo Degraded triggers rollback", () => {
  it("deletes manifests + DNS when Argo reports Degraded, throws DeployError", async () => {
    const k8s = new InMemoryKubernetesClient();
    const cf = new InMemoryCloudflareClient();
    // Override Argo health to Degraded after apply.
    const origApply = k8s.apply.bind(k8s);
    k8s.apply = async (ns, kind, name, yaml) => {
      await origApply(ns, kind, name, yaml);
      if (kind === "Application") k8s.setHealth(name, "Degraded");
    };
    const orch = new DeployOrchestrator({
      kubernetes: k8s,
      cloudflare: cf,
      branching: branchingStub,
      migrate: migrateStub,
      manifestRepoUrl: "x",
      issuerRef: "x",
      ingressTarget: "x",
      reconcileIntervalMs: 5
    });
    await expect(
      orch.deploy({
        projectId: "11111111-1111-4111-8111-111111111111",
        branchId: "main",
        imageRef: "x@sha256:" + "0".repeat(64),
        target: "production",
        subdomain: "abc",
        apex: "atlas.app",
        env: {}
      })
    ).rejects.toThrow(DeployError);
    // Rollback removed everything.
    expect(k8s.get("argocd", "Application", "p-abc-main")).toBeUndefined();
    expect(k8s.get("atlas-projects", "Service", "p-abc-main")).toBeUndefined();
    expect(cf.list("atlas.app")).toEqual([]);
  });
});
