import { describe, it, expect, vi } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { runDeployFromArtifacts } from "../src/deploy-from-artifacts.js";
import type { GitClient } from "../src/gitops-repo.js";
import type { CommandRunner } from "../src/image-builder.js";
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
    file: "argo/proj-1-main.yaml",
    name: "proj-1-main",
    repoUrl: "git@example.com:atlas/gitops.git",
    path: "applications/",
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
      listBranches: async () => []
    },
    migrate: async (i: { schemaName: string }) => ({
      schemaName: i.schemaName,
      applied: 0,
      filenames: [] as string[]
    }),
    ingressTarget: "ingress.example.com",
    reconcileIntervalMs: 1,
    reconcileTimeoutMs: 50
  };
}

function makeFakeGitClient(): GitClient & { calls: Array<{ op: string; args: unknown[] }> } {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  return {
    calls,
    clone: vi.fn(async (...a: unknown[]) => {
      calls.push({ op: "clone", args: a });
    }),
    add: vi.fn(async (...a: unknown[]) => {
      calls.push({ op: "add", args: a });
    }),
    commit: vi.fn(async (...a: unknown[]) => {
      calls.push({ op: "commit", args: a });
      return { sha: "abcdef0123456789", committed: true };
    }),
    push: vi.fn(async (...a: unknown[]) => {
      calls.push({ op: "push", args: a });
    }),
    headSha: vi.fn(async () => "abcdef0123456789")
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

describe("runDeployFromArtifacts — Plan F.5 gitops wiring", () => {
  it("does NOT k8s-apply the Argo Application when opts.gitops is configured", async () => {
    const opts = makeOpts();
    const gitClient = makeFakeGitClient();
    // Seed the in-memory cluster with a Healthy Application so the reconcile
    // loop completes (in real life, Argo CD would create the resource after
    // the gitops repo push; here we simulate that for testability).
    opts.kubernetes.setHealth("proj-1-main", "Healthy");

    const applyCalls: Array<{ kind: string; name: string }> = [];
    const origApply = opts.kubernetes.apply.bind(opts.kubernetes);
    opts.kubernetes.apply = async (ns, kind, name, yaml) => {
      applyCalls.push({ kind, name });
      return origApply(ns, kind, name, yaml);
    };

    await runDeployFromArtifacts(
      {
        ...opts,
        gitops: { repoUrl: "git@example.com:atlas/gitops.git", gitClient }
      },
      INPUT
    );

    // The Service IaC manifest IS applied. The Argo Application is NOT.
    expect(applyCalls.some((c) => c.kind === "Service" && c.name === "api")).toBe(true);
    expect(applyCalls.some((c) => c.kind === "Application")).toBe(false);

    // The git client WAS invoked.
    const ops = gitClient.calls.map((c) => c.op);
    expect(ops).toContain("clone");
    expect(ops).toContain("commit");
    expect(ops).toContain("push");
  });

  it("DOES k8s-apply the Argo Application when opts.gitops is undefined (regression guard)", async () => {
    const opts = makeOpts();
    const applyCalls: Array<{ kind: string; name: string }> = [];
    const origApply = opts.kubernetes.apply.bind(opts.kubernetes);
    opts.kubernetes.apply = async (ns, kind, name, yaml) => {
      applyCalls.push({ kind, name });
      return origApply(ns, kind, name, yaml);
    };

    await runDeployFromArtifacts(opts, INPUT);

    expect(applyCalls.some((c) => c.kind === "Application" && c.name === "proj-1-main")).toBe(true);
  });

  it("threads opts.imageBuildParallelism into buildAndPushImages (concurrent dispatch observed)", async () => {
    const opts = makeOpts();
    const IMAGES = [
      { serviceName: "api", dockerfilePath: "./api/Dockerfile", imageTag: "reg.local/api:1" },
      { serviceName: "web", dockerfilePath: "./web/Dockerfile", imageTag: "reg.local/web:1" },
      { serviceName: "worker", dockerfilePath: "./worker/Dockerfile", imageTag: "reg.local/worker:1" }
    ];

    let inFlight = 0;
    let maxInFlight = 0;
    const imageRunner: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "build") {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runDeployFromArtifacts(
      { ...opts, imageRunner, imageBuildParallelism: 3, skipImagePush: true },
      {
        ...INPUT,
        deployArtifact: { ...DEPLOY, imageBuilds: IMAGES }
      }
    );

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("returns a gitops-namespaced applied entry for the Application", async () => {
    const opts = makeOpts();
    const gitClient = makeFakeGitClient();
    opts.kubernetes.setHealth("proj-1-main", "Healthy");

    const r = await runDeployFromArtifacts(
      {
        ...opts,
        gitops: { repoUrl: "git@example.com:atlas/gitops.git", gitClient }
      },
      INPUT
    );

    const gitopsEntry = r.appliedManifests.find((m) => m.namespace === "gitops");
    expect(gitopsEntry).toBeDefined();
    expect(gitopsEntry?.kind).toBe("Application");
    expect(gitopsEntry?.name).toBe("proj-1-main");
  });
});
