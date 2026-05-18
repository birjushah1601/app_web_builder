import { describe, expect, it } from "vitest";
import { i04PiiMutatingEndpointNeedsAuthAndCompliance } from "../../src/invariants/i04-pii-mutating-endpoint-needs-auth-and-compliance.js";
import type { SpecGraph } from "../../src/graph.js";

const baseGraph = (extras: Partial<SpecGraph> = {}): SpecGraph => ({
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: [],
  ...extras
});

describe("i04: Endpoint mutating PII Model needs auth + compliance", () => {
  it("ok when no endpoint mutates PII", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:listUsers": {
          kind: "endpoint",
          id: "endpoint:listUsers",
          name: "listUsers",
          routeRef: "GET /api/users",
          method: "GET"
        }
      } as never
    });
    expect(i04PiiMutatingEndpointNeedsAuthAndCompliance(g)).toEqual([]);
  });

  it("ok when PII-mutating endpoint has auth + compliance edges", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:createUser": {
          kind: "endpoint",
          id: "endpoint:createUser",
          name: "createUser",
          routeRef: "POST /api/users",
          method: "POST"
        },
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: { select: "true", insert: "true", update: "true", delete: "true" },
          piiClassification: "direct"
        },
        "authboundary:user": {
          kind: "authboundary",
          id: "authboundary:user",
          name: "UserAuth",
          type: "role",
          roles: ["user"],
          permissions: [],
          bypassConditions: []
        },
        "compliance:baseline": {
          kind: "compliance",
          id: "compliance:baseline",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never,
      edges: [
        { type: "mutates", from: "endpoint:createUser", to: "model:User" },
        { type: "requires", from: "endpoint:createUser", to: "authboundary:user" },
        { type: "subjectTo", from: "endpoint:createUser", to: "compliance:baseline" }
      ] as never
    });
    expect(i04PiiMutatingEndpointNeedsAuthAndCompliance(g)).toEqual([]);
  });

  it("flags missing auth", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:createUser": {
          kind: "endpoint",
          id: "endpoint:createUser",
          name: "createUser",
          routeRef: "POST /api/users",
          method: "POST"
        },
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: { select: "true", insert: "true", update: "true", delete: "true" },
          piiClassification: "direct"
        },
        "compliance:baseline": {
          kind: "compliance",
          id: "compliance:baseline",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never,
      edges: [
        { type: "mutates", from: "endpoint:createUser", to: "model:User" },
        { type: "subjectTo", from: "endpoint:createUser", to: "compliance:baseline" }
      ] as never
    });
    const issues = i04PiiMutatingEndpointNeedsAuthAndCompliance(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I04_PII_ENDPOINT_MISSING_AUTH");
    expect(issues[0]?.nodeId).toBe("endpoint:createUser");
  });

  it("flags missing compliance", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:createUser": {
          kind: "endpoint",
          id: "endpoint:createUser",
          name: "createUser",
          routeRef: "POST /api/users",
          method: "POST"
        },
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: { select: "true", insert: "true", update: "true", delete: "true" },
          piiClassification: "direct"
        },
        "authboundary:user": {
          kind: "authboundary",
          id: "authboundary:user",
          name: "UserAuth",
          type: "role",
          roles: ["user"],
          permissions: [],
          bypassConditions: []
        }
      } as never,
      edges: [
        { type: "mutates", from: "endpoint:createUser", to: "model:User" },
        { type: "requires", from: "endpoint:createUser", to: "authboundary:user" }
      ] as never
    });
    const issues = i04PiiMutatingEndpointNeedsAuthAndCompliance(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I04_PII_ENDPOINT_MISSING_COMPLIANCE");
    expect(issues[0]?.nodeId).toBe("endpoint:createUser");
  });
});
