import { describe, expect, it } from "vitest";
import { SpecGraphSchema } from "../src/graph.js";

const minimal = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: []
};

describe("SpecGraphSchema", () => {
  it("accepts a minimal graph", () => {
    expect(() => SpecGraphSchema.parse(minimal)).not.toThrow();
  });
  it("rejects schemaVersion not equal to 1.0.0", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, schemaVersion: "0.9.0" })).toThrow();
  });
  it("rejects empty complianceClasses (baseline must be present)", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, complianceClasses: [] })).toThrow();
  });
  it("rejects extra top-level keys", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, extra: 1 })).toThrow();
  });
  it("nodes is keyed by NodeId pattern", () => {
    expect(() =>
      SpecGraphSchema.parse({
        ...minimal,
        nodes: {
          "page:home": {
            kind: "page",
            id: "page:home",
            path: "/",
            title: "Home",
            renderMode: "ssr"
          }
        }
      })
    ).not.toThrow();
  });
  it("edges is an array of Edge", () => {
    expect(() =>
      SpecGraphSchema.parse({
        ...minimal,
        edges: [{ type: "renders", from: "page:home", to: "component:Button" }]
      })
    ).not.toThrow();
  });
});
