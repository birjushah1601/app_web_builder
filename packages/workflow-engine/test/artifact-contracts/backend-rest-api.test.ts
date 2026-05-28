import { describe, it, expect } from "vitest";
import { BackendArtifactSchema } from "../../src/artifact-contracts/backend-rest-api.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/index.js";

describe("BackendArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "backend-rest-api" as const,
    openApiSpec: { openapi: "3.1.0", paths: {} },
    routes: [{ method: "get", path: "/health" }],
    envContract: [],
    sandboxId: "sb-1",
    previewUrl: "https://example.com"
  };

  it("accepts a minimal valid artifact", () => {
    const r = BackendArtifactSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects a wrong kind literal", () => {
    const r = BackendArtifactSchema.safeParse({ ...valid, kind: "frontend-app" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL previewUrl", () => {
    const r = BackendArtifactSchema.safeParse({ ...valid, previewUrl: "not a url" });
    expect(r.success).toBe(false);
  });

  it("accepts optional dbDdl + envContract entries", () => {
    const r = BackendArtifactSchema.safeParse({
      ...valid,
      dbDdl: "CREATE TABLE x ()",
      envContract: [{ name: "FOO", required: true, description: "x" }]
    });
    expect(r.success).toBe(true);
  });

  it("is registered against the kind 'backend-rest-api' in ArtifactContractRegistry", () => {
    expect(ArtifactContractRegistry.has("backend-rest-api")).toBe(true);
  });
});
