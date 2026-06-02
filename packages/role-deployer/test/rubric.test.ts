import { describe, it, expect, vi } from "vitest";
import { deployerRubric } from "../src/rubric.js";
import type { DeployArtifact } from "@atlas/workflow-engine";

const GOOD_ARTIFACT: DeployArtifact = {
  schemaVersion: "1",
  kind: "deploy",
  target: "k8s",
  argoApplication: {
    file: "argo/app.yaml",
    content: "apiVersion: argoproj.io/v1alpha1\nkind: Application\n",
    name: "atlas-r-1",
    repoUrl: "https://git.example.com/r1.git",
    path: "k8s/"
  },
  imageBuilds: [
    { serviceName: "api", dockerfilePath: "services/api/Dockerfile", imageTag: "registry.atlas.local/projects/api:r1" }
  ],
  smokeTests: [
    { url: "https://r1.preview.atlas.local/health", expectStatus: 200 }
  ]
};

describe("deployerRubric.structural", () => {
  it("passes a valid DeployArtifact", () => {
    const result = deployerRubric.structural(GOOD_ARTIFACT, {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails schema when artifact is malformed", () => {
    const bad = { schemaVersion: "1", kind: "deploy" } as unknown as DeployArtifact;
    const result = deployerRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "schema")).toBe(true);
    }
  });

  it("fails argo_app_name_present when argoApplication.name is empty", () => {
    // The schema requires name.min(1), so an empty name fails the schema check
    // first. We assert the rubric reports it as a structural failure (whether
    // surfaced via the `schema` or `argo_app_name_present` bucket is OK so long
    // as it is reported).
    const bad = {
      ...GOOD_ARTIFACT,
      argoApplication: { ...GOOD_ARTIFACT.argoApplication, name: "" }
    } as unknown as DeployArtifact;
    const result = deployerRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(
        result.failures.some((f) => f.check === "argo_app_name_present" || f.check === "schema")
      ).toBe(true);
    }
  });
});

describe("deployerRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true,
          score: 7,
          dimensions: [{ name: "deploy_completeness", score: 7, rationale: "ok" }],
          fixableBy: "retry",
          feedback: "ok"
        }
      })
    };
    const result = await deployerRubric.judge(GOOD_ARTIFACT, { userTurn: "deploy it" } as any, stubLlm as any);
    expect(result.passed).toBe(true);
    expect(stubLlm.completeWithToolUse).toHaveBeenCalledOnce();
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: "bad", dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      deployerRubric.judge(GOOD_ARTIFACT, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
