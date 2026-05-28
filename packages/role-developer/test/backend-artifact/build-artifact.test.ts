import { describe, it, expect } from "vitest";
import { buildBackendArtifact } from "../../src/backend-artifact/build-artifact.js";

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "demo", version: "0.0.1" },
  paths: {
    "/health": {
      get: { operationId: "get_health", responses: { "200": { description: "ok" } } }
    },
    "/items": {
      post: {
        operationId: "create_item",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "created", content: { "application/json": { schema: { type: "object" } } } } }
      }
    }
  }
};

describe("buildBackendArtifact", () => {
  it("derives routes from the OpenAPI paths object", () => {
    const a = buildBackendArtifact({
      openApiSpec: OPENAPI,
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.kind).toBe("backend-rest-api");
    expect(a.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "get", path: "/health", opId: "get_health" }),
        expect.objectContaining({ method: "post", path: "/items", opId: "create_item" })
      ])
    );
  });

  it("threads previewUrl + envContract + dbDdl through verbatim", () => {
    const a = buildBackendArtifact({
      openApiSpec: OPENAPI,
      envContract: [{ name: "DATABASE_URL", required: true, description: "Postgres URL" }],
      sandboxId: "sb-1",
      previewUrl: "https://sb-1.preview.e2b.dev",
      dbDdl: "CREATE TABLE items (id SERIAL PRIMARY KEY)"
    });
    expect(a.previewUrl).toBe("https://sb-1.preview.e2b.dev");
    expect(a.envContract).toHaveLength(1);
    expect(a.dbDdl).toContain("CREATE TABLE items");
  });

  it("handles an empty paths object as zero routes", () => {
    const a = buildBackendArtifact({
      openApiSpec: { openapi: "3.1.0", paths: {} },
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.routes).toEqual([]);
  });

  it("ignores non-HTTP-verb keys (parameters, summary) on a path item", () => {
    const a = buildBackendArtifact({
      openApiSpec: {
        openapi: "3.1.0",
        paths: {
          "/x": {
            summary: "ignored",
            parameters: [],
            get: { operationId: "x_get", responses: { "200": { description: "" } } }
          }
        }
      },
      envContract: [],
      sandboxId: "sb-1"
    });
    expect(a.routes).toHaveLength(1);
    expect(a.routes[0]?.method).toBe("get");
  });
});
