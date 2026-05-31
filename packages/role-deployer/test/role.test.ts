import { describe, it, expect, vi } from "vitest";
import { DeployerRole } from "../src/role.js";

const VALID_ARGO = { file: "argo/app.yaml", content: "kind: Application", name: "proj-1", repoUrl: "git@x:y.git", path: "k8s/" };
const VALID_IMG = { serviceName: "api", dockerfilePath: "Dockerfile.api", imageTag: "reg/proj/api:sha" };
const VALID_SMOKE = { url: "/health", expectStatus: 200 };

const IAC_UPSTREAM = {
  schemaVersion: "1",
  kind: "iac",
  compose: { file: "docker-compose.yml", content: "version: '3'" },
  k8s: { manifests: [] },
  services: [],
  imageRegistry: { url: "reg", namespace: "proj" }
};

describe("DeployerRole", () => {
  it("emits ritual.artifact_emitted with a valid DeployArtifact", async () => {
    const generateDeploy = vi.fn(async () => ({
      argoApplication: VALID_ARGO,
      imageBuilds: [VALID_IMG],
      smokeTests: [VALID_SMOKE]
    }));
    const role = new DeployerRole({ generateDeploy });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { iacNode: IAC_UPSTREAM } }
    });
    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; target: string; imageBuilds: unknown[] } }).artifact;
    expect(artifact.kind).toBe("deploy");
    expect(artifact.target).toBe("k8s");
    expect(artifact.imageBuilds).toHaveLength(1);
    expect(generateDeploy).toHaveBeenCalledOnce();
  });

  it("emits deployer.failed when no upstream iac artifact present", async () => {
    const role = new DeployerRole({ generateDeploy: vi.fn() });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { backend: { kind: "backend-rest-api" } } }
    });
    expect(out.events.some((e) => e.eventType === "deployer.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
  });

  it("emits deployer.failed when generateDeploy throws", async () => {
    const role = new DeployerRole({ generateDeploy: vi.fn(async () => { throw new Error("LLM gone"); }) });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { iacNode: IAC_UPSTREAM } }
    });
    expect(out.events.some((e) => e.eventType === "deployer.failed")).toBe(true);
  });

  it("finds the iac artifact regardless of its upstream key name", async () => {
    const generateDeploy = vi.fn(async () => ({
      argoApplication: VALID_ARGO, imageBuilds: [], smokeTests: []
    }));
    const role = new DeployerRole({ generateDeploy });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { "iac-of-proj": IAC_UPSTREAM, other: { kind: "tests" } } }
    });
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(true);
  });
});
