import { describe, it, expect, vi } from "vitest";
import { backendArtifactRubric } from "../../src/backend-artifact/rubric.js";
import type { BackendArtifact } from "@atlas/workflow-engine";

const GOOD_OPENAPI = {
  openapi: "3.0.0",
  info: { title: "test", version: "1" },
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        responses: {
          "200": { description: "ok" }
        }
      }
    }
  }
};

const GOOD_ARTIFACT: BackendArtifact = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: GOOD_OPENAPI,
  routes: [
    { method: "get", path: "/health", opId: "getHealth" }
  ],
  envContract: [{ name: "DATABASE_URL", required: true }],
  sandboxId: "sb-1",
  previewUrl: "https://preview.example.com"
};

describe("backendArtifactRubric.structural", () => {
  it("passes a valid BackendArtifact", () => {
    const result = backendArtifactRubric.structural(GOOD_ARTIFACT, {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails schema when required fields are missing", () => {
    const bad = { schemaVersion: "1", kind: "backend-rest-api" } as unknown as BackendArtifact;
    const result = backendArtifactRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "schema")).toBe(true);
    }
  });

  it("fails routes_present when routes array is empty", () => {
    const bad: BackendArtifact = { ...GOOD_ARTIFACT, routes: [] };
    const result = backendArtifactRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "routes_present")).toBe(true);
    }
  });

  it("fails openapi_paths_present when openApiSpec has no paths", () => {
    const bad: BackendArtifact = {
      ...GOOD_ARTIFACT,
      openApiSpec: { openapi: "3.0.0", info: { title: "x", version: "1" } }
    };
    const result = backendArtifactRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "openapi_paths_present")).toBe(true);
    }
  });

  it("fails openapi_paths_present when paths is an empty object", () => {
    const bad: BackendArtifact = {
      ...GOOD_ARTIFACT,
      openApiSpec: { openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} },
      routes: [{ method: "get", path: "/x" }]
    };
    const result = backendArtifactRubric.structural(bad, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "openapi_paths_present")).toBe(true);
    }
  });
});

describe("backendArtifactRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true,
          score: 7,
          dimensions: [{ name: "completeness", score: 7, rationale: "ok" }],
          fixableBy: "retry",
          feedback: "looks ok"
        }
      })
    };
    const result = await backendArtifactRubric.judge(GOOD_ARTIFACT, { userTurn: "ship a backend" } as any, stubLlm as any);
    expect(result.passed).toBe(true);
    expect(stubLlm.completeWithToolUse).toHaveBeenCalledOnce();
  });

  it("throws when judge response fails schema validation", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: { passed: true, score: -5, dimensions: [], fixableBy: "retry", feedback: "" }
      })
    };
    await expect(
      backendArtifactRubric.judge(GOOD_ARTIFACT, { userTurn: "x" } as any, stubLlm as any)
    ).rejects.toThrow();
  });
});
