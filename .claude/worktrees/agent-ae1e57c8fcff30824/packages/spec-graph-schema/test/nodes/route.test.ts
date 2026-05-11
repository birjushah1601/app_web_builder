import { describe, expect, it } from "vitest";
import { RouteSchema } from "../../src/nodes/route.js";

const valid = {
  kind: "route" as const,
  id: "route:get-users",
  pattern: "/api/users",
  method: "GET",
  handlerType: "endpoint"
};

describe("RouteSchema", () => {
  it("accepts a valid route", () => {
    expect(() => RouteSchema.parse(valid)).not.toThrow();
  });
  it("requires pattern", () => {
    expect(() => RouteSchema.parse({ ...valid, pattern: undefined })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => RouteSchema.parse({ ...valid, method: "QUACK" })).toThrow();
  });
  it("rejects unknown handlerType", () => {
    expect(() => RouteSchema.parse({ ...valid, handlerType: "wizard" })).toThrow();
  });
  it("accepts handlerType=page with method=GET", () => {
    expect(() =>
      RouteSchema.parse({ ...valid, handlerType: "page", method: "GET" })
    ).not.toThrow();
  });
  it("rejects extra properties", () => {
    expect(() => RouteSchema.parse({ ...valid, mystery: 1 })).toThrow();
  });
});
