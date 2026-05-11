import { describe, expect, it } from "vitest";
import { EndpointSchema } from "../../src/nodes/endpoint.js";

const valid = {
  kind: "endpoint" as const,
  id: "endpoint:createUser",
  name: "createUser",
  routeRef: "POST /api/users",
  method: "POST",
  inputSchema: { email: "string" },
  outputSchema: { id: "uuid" },
  authRef: "authboundary:authenticated",
  rateLimit: { window: "1m", max: 60 }
};

describe("EndpointSchema", () => {
  it("accepts valid endpoint", () => {
    expect(() => EndpointSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => EndpointSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("requires routeRef", () => {
    expect(() => EndpointSchema.parse({ ...valid, routeRef: undefined })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => EndpointSchema.parse({ ...valid, method: "TRACE-X" })).toThrow();
  });
  it("rateLimit window must match a duration pattern", () => {
    expect(() =>
      EndpointSchema.parse({ ...valid, rateLimit: { window: "fortnight", max: 1 } })
    ).toThrow();
  });
});
