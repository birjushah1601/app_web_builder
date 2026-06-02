import { describe, it, expect, vi } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { runDeployFromArtifacts } from "../src/deploy-from-artifacts.js";
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
          "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n  namespace: atlas-projects\nspec: {}"
      },
      {
        file: "k8s/cert.yaml",
        kind: "Certificate",
        name: "wildcard",
        content:
          "apiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata:\n  name: wildcard\nspec: {}"
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
    name: "proj-1-main",
    repoUrl: "git@x:y.git",
    path: "k8s/",
    content:
      "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec: {}"
  },
  imageBuilds: [],
  smokeTests: []
};

function makeOpts() {
  const kubernetes = new InMemoryKubernetesClient();
  const cloudflare = new InMemoryCloudflareClient();
  return {
    kubernetes,
    cloudflare,
    branching: {
      ensureBranch: async (_p: string, b: string) => ({
        created: true,
        schemaName: `branch_${b}`
      }),
      dropBranch: async (_p: string, b: string) => ({
        schemaName: `branch_${b}`,
        dropped: true
      }),
      listBranches: async (_p: string) => []
    },
    migrate: async (input: { schemaName: string }) => ({
      schemaName: input.schemaName,
      applied: 0,
      filenames: [] as string[]
    }),
    ingressTarget: "ingress.example.com",
    reconcileIntervalMs: 1,
    reconcileTimeoutMs: 50
  };
}

const INPUT = {
  projectId: "p-1",
  branchId: "main",
  subdomain: "proj-1",
  apex: "atlas.dev",
  iacArtifact: IAC,
  deployArtifact: DEPLOY
};

describe("runDeployFromArtifacts", () => {
  it("applies every k8s manifest + argo app via kubernetes-client", async () => {
    const opts = makeOpts();
    // InMemoryKubernetesClient.apply auto-marks Application as Healthy.
    const r = await runDeployFromArtifacts(opts, INPUT);
    expect(r.phase).toBe("healthy");
    expect(r.publicUrl).toBe("https://proj-1.atlas.dev");
    expect(r.argoApplicationName).toBe("proj-1-main");
    expect(r.appliedManifests).toHaveLength(3); // 2 iac + 1 argo
    // Spot-check the applied manifests landed in the store.
    expect(opts.kubernetes.get("atlas-projects", "Service", "api")).toBeDefined();
    expect(opts.kubernetes.get("atlas-projects", "Certificate", "wildcard")).toBeDefined();
    expect(opts.kubernetes.get("argocd", "Application", "proj-1-main")).toBeDefined();
  });

  it("rolls back applied manifests + DNS when Argo reports unhealthy", async () => {
    const opts = makeOpts();
    // Override the auto-Healthy by forcing Degraded before reconcile sees it.
    const origApply = opts.kubernetes.apply.bind(opts.kubernetes);
    opts.kubernetes.apply = async (ns, kind, name, yaml) => {
      await origApply(ns, kind, name, yaml);
      if (kind === "Application") opts.kubernetes.setHealth(name, "Degraded");
    };
    await expect(runDeployFromArtifacts(opts, INPUT)).rejects.toThrow(
      /deploy.*rolled back|Degraded/i
    );
    // All applied manifests should be deleted (rollback).
    expect(opts.kubernetes.get("atlas-projects", "Service", "api")).toBeUndefined();
    expect(opts.kubernetes.get("atlas-projects", "Certificate", "wildcard")).toBeUndefined();
    expect(opts.kubernetes.get("argocd", "Application", "proj-1-main")).toBeUndefined();
    // DNS torn down too.
    expect(opts.cloudflare.list("atlas.dev")).toHaveLength(0);
  });

  it("ensures the DB branch + runs migrate when branch is newly created", async () => {
    const migrate = vi.fn(async (input: { schemaName: string }) => ({
      schemaName: input.schemaName,
      applied: 0,
      filenames: [] as string[]
    }));
    const opts = { ...makeOpts(), migrate };
    await runDeployFromArtifacts(opts, INPUT);
    expect(migrate).toHaveBeenCalledWith({ schemaName: "branch_main" });
  });

  it("skips migrate when branch already exists", async () => {
    const migrate = vi.fn(async (input: { schemaName: string }) => ({
      schemaName: input.schemaName,
      applied: 0,
      filenames: [] as string[]
    }));
    const opts = {
      ...makeOpts(),
      branching: {
        ensureBranch: async () => ({ created: false, schemaName: "branch_main" }),
        dropBranch: async () => ({ schemaName: "branch_main", dropped: true }),
        listBranches: async () => []
      },
      migrate
    };
    await runDeployFromArtifacts(opts, INPUT);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("upserts DNS via cloudflare-client", async () => {
    const opts = makeOpts();
    await runDeployFromArtifacts(opts, INPUT);
    const dns = opts.cloudflare.list("atlas.dev");
    expect(dns).toHaveLength(1);
    expect(dns[0]).toMatchObject({
      name: "proj-1.atlas.dev",
      type: "CNAME",
      content: "ingress.example.com"
    });
  });
});
