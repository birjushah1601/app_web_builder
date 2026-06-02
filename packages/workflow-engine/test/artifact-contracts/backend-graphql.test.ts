// Plan D.4 Task 3 — BackendGraphqlArtifact schema + registration.
import { describe, it, expect } from "vitest";
import { BackendGraphqlArtifactSchema } from "../../src/artifact-contracts/backend-graphql.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/index.js";

describe("BackendGraphqlArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "backend-graphql" as const,
    graphqlSchema: "type Query { health: String! }",
    envContract: [],
    sandboxId: "sb-1",
    previewUrl: "https://example.com"
  };

  it("accepts a minimal valid artifact", () => {
    const r = BackendGraphqlArtifactSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects a wrong kind literal", () => {
    const r = BackendGraphqlArtifactSchema.safeParse({
      ...valid,
      kind: "backend-rest-api"
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL previewUrl", () => {
    const r = BackendGraphqlArtifactSchema.safeParse({
      ...valid,
      previewUrl: "not a url"
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional operations + envContract entries", () => {
    const r = BackendGraphqlArtifactSchema.safeParse({
      ...valid,
      operations: "query Health { health }",
      envContract: [{ name: "FOO", required: true, description: "x" }]
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty graphqlSchema", () => {
    const r = BackendGraphqlArtifactSchema.safeParse({
      ...valid,
      graphqlSchema: ""
    });
    expect(r.success).toBe(false);
  });

  it("is registered against the kind 'backend-graphql' in ArtifactContractRegistry", () => {
    expect(ArtifactContractRegistry.has("backend-graphql")).toBe(true);
  });
});
