import { describe, it, expect } from "vitest";
import { generateApiClient } from "../src/api-client-gen.js";

const SIMPLE_SPEC = {
  openapi: "3.1.0",
  info: { title: "Demo", version: "0.0.1" },
  paths: {
    "/health": {
      get: {
        operationId: "get_health",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" } },
                  required: ["status"]
                }
              }
            }
          }
        }
      }
    }
  }
};

describe("generateApiClient", () => {
  it("returns the canonical lib/api-client.ts path", async () => {
    const r = await generateApiClient(SIMPLE_SPEC);
    expect(r.path).toBe("lib/api-client.ts");
  });

  it("emits TypeScript that includes the paths interface", async () => {
    const r = await generateApiClient(SIMPLE_SPEC);
    expect(r.contents).toMatch(/export\s+interface\s+paths/);
    expect(r.contents).toContain("/health");
  });

  it("includes components when the spec defines schemas", async () => {
    const withComponents = {
      ...SIMPLE_SPEC,
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        }
      }
    };
    const r = await generateApiClient(withComponents);
    expect(r.contents).toMatch(/User/);
  });

  it("throws on a non-OpenAPI object", async () => {
    await expect(generateApiClient({ not: "openapi" } as never)).rejects.toThrow();
  });

  // Plan D.3 Task 1 — optional fileName parameter for multi-backend cross-stack.
  it("accepts an optional fileName and uses it for the returned path", async () => {
    const r = await generateApiClient(SIMPLE_SPEC, {
      fileName: "api-client-backend-x.ts"
    });
    expect(r.path).toBe("lib/api-client-backend-x.ts");
    // Contents are independent of fileName — still valid TS.
    expect(r.contents).toMatch(/export\s+interface\s+paths/);
  });

  it("defaults to lib/api-client.ts when no fileName is provided", async () => {
    const r = await generateApiClient(SIMPLE_SPEC, {});
    expect(r.path).toBe("lib/api-client.ts");
  });
});
