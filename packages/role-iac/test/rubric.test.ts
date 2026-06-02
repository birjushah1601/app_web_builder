import { describe, it, expect, vi } from "vitest";
import { iacRubric } from "../src/rubric.js";
import type { IacArtifact } from "@atlas/workflow-engine";

const GOOD_ARTIFACT: IacArtifact = {
  schemaVersion: "1",
  kind: "iac",
  compose: { file: "docker-compose.yml", content: "version: '3'\nservices:\n  api: {}\n" },
  k8s: {
    manifests: [
      { file: "k8s/api.yaml", kind: "Service", name: "api", content: "kind: Service\nmetadata:\n  name: api\n" }
    ]
  },
  services: [
    {
      name: "api",
      runtimeNodeId: "backend",
      artifactKind: "backend-rest-api",
      port: 8000,
      envContract: [{ name: "DB_URL", required: true }]
    }
  ],
  imageRegistry: { url: "registry.atlas.local/projects", namespace: "default" }
};

describe("iacRubric.structural", () => {
  it("passes a valid IacArtifact", () => {
    const result = iacRubric.structural(GOOD_ARTIFACT, {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails when artifact is missing required fields (schema)", () => {
    const bad = { schemaVersion: "1", kind: "iac" } as unknown as IacArtifact;
    const result = iacRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "schema")).toBe(true);
    }
  });

  it("fails services_present when services array is empty", () => {
    const bad: IacArtifact = { ...GOOD_ARTIFACT, services: [] };
    const result = iacRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "services_present")).toBe(true);
    }
  });

  it("fails k8s_manifest_present when k8s.manifests is empty", () => {
    const bad: IacArtifact = { ...GOOD_ARTIFACT, k8s: { manifests: [] } };
    const result = iacRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "k8s_manifest_present")).toBe(true);
    }
  });
});

describe("iacRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true,
          score: 8,
          dimensions: [{ name: "completeness", score: 8, rationale: "all services covered" }],
          fixableBy: "retry",
          feedback: "ok"
        }
      })
    };
    const result = await iacRubric.judge(GOOD_ARTIFACT, { userTurn: "deploy it" } as any, stubLlm as any);
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(8);
    expect(stubLlm.completeWithToolUse).toHaveBeenCalledOnce();
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: 999, dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      iacRubric.judge(GOOD_ARTIFACT, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
