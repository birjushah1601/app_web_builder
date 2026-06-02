import { describe, it, expect, vi } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { runDeployFromArtifacts } from "../src/deploy-from-artifacts.js";
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
    file: "argo/app.yaml",
    name: "proj-1-main",
    repoUrl: "git@x:y.git",
    path: "k8s/",
    content:
      "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec: {}"
  },
  imageBuilds: [
    { serviceName: "api", dockerfilePath: "./svc/api/Dockerfile", imageTag: "reg.local/atlas/api:abc" }
  ],
  smokeTests: []
};

function makeOpts() {
  const kubernetes = new InMemoryKubernetesClient();
  const cloudflare = new InMemoryCloudflareClient();
  return {
    kubernetes,
    cloudflare,
    branching: {
      ensureBranch: async (_p: string, b: string) => ({ created: true, schemaName: `branch_${b}` }),
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
    reconcileTimeoutMs: 50,
    // Tests don't have a real registry; skipImagePush keeps the runner from
    // attempting docker push.
    skipImagePush: true
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

describe("runDeployFromArtifacts — Plan F.4 image build", () => {
  it("attaches imageBuilds when every build succeeds", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const r = await runDeployFromArtifacts({ ...opts, imageRunner }, INPUT);
    expect(r.imageBuilds).toBeDefined();
    expect(r.imageBuilds).toHaveLength(1);
    expect(r.imageBuilds?.[0]?.ok).toBe(true);
    expect(r.imageBuilds?.[0]?.serviceName).toBe("api");
  });

  it("runs the image builder BEFORE applying any k8s manifests", async () => {
    const opts = makeOpts();
    const callOrder: string[] = [];
    const imageRunner: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
      callOrder.push(`docker ${args[0]}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const origApply = opts.kubernetes.apply.bind(opts.kubernetes);
    opts.kubernetes.apply = async (ns, kind, name, yaml) => {
      callOrder.push(`k8s.apply ${kind}/${name}`);
      return origApply(ns, kind, name, yaml);
    };
    await runDeployFromArtifacts({ ...opts, imageRunner }, INPUT);
    const firstK8s = callOrder.findIndex((c) => c.startsWith("k8s.apply"));
    const lastDocker =
      callOrder
        .map((c, i) => (c.startsWith("docker") ? i : -1))
        .filter((i) => i >= 0)
        .pop() ?? -1;
    expect(firstK8s).toBeGreaterThan(-1);
    expect(lastDocker).toBeGreaterThan(-1);
    expect(lastDocker).toBeLessThan(firstK8s);
  });

  it("throws DeployError BEFORE any k8s apply when an image build fails", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "no such file: Dockerfile",
      exitCode: 1
    }));
    let appliedSomething = false;
    opts.kubernetes.apply = async () => {
      appliedSomething = true;
    };
    await expect(runDeployFromArtifacts({ ...opts, imageRunner }, INPUT)).rejects.toThrow(
      /image build.*failed|no such file/i
    );
    expect(appliedSomething).toBe(false);
  });

  it("skips the builder when imageBuilds is empty (no runner call)", async () => {
    const opts = makeOpts();
    const imageRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const r = await runDeployFromArtifacts(
      { ...opts, imageRunner },
      { ...INPUT, deployArtifact: { ...DEPLOY, imageBuilds: [] } }
    );
    expect(imageRunner).not.toHaveBeenCalled();
    expect(r.imageBuilds).toBeUndefined();
  });
});
