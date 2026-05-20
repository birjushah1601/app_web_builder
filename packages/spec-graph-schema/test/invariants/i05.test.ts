import { describe, expect, it } from "vitest";
import { i05PiiModelNeedsRls } from "../../src/invariants/i05-pii-model-needs-rls.js";
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

describe("i05: PII Model must have RLS policies for all four actions", () => {
  it("ok when PII model has all four RLS policies", () => {
    const g = baseGraph({
      nodes: {
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: { select: "true", insert: "true", update: "true", delete: "true" },
          piiClassification: "direct"
        }
      } as never
    });
    expect(i05PiiModelNeedsRls(g)).toEqual([]);
  });

  it("ok when non-PII model has no RLS", () => {
    const g = baseGraph({
      nodes: {
        "model:AuditLog": {
          kind: "model",
          id: "model:AuditLog",
          name: "AuditLog",
          fields: { id: "uuid", event: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: {},
          piiClassification: "none"
        }
      } as never
    });
    expect(i05PiiModelNeedsRls(g)).toEqual([]);
  });

  it("flags PII model missing RLS policies", () => {
    const g = baseGraph({
      nodes: {
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: {},
          piiClassification: "direct"
        }
      } as never
    });
    const issues = i05PiiModelNeedsRls(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I05_PII_MODEL_MISSING_RLS");
    expect(issues[0]?.nodeId).toBe("model:User");
    expect(issues[0]?.message).toContain("select");
    expect(issues[0]?.message).toContain("insert");
    expect(issues[0]?.message).toContain("update");
    expect(issues[0]?.message).toContain("delete");
  });

  it("flags PII model with partial RLS policies", () => {
    const g = baseGraph({
      nodes: {
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { id: "uuid", email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: { select: "true", insert: "" },
          piiClassification: "indirect"
        }
      } as never
    });
    const issues = i05PiiModelNeedsRls(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I05_PII_MODEL_MISSING_RLS");
    expect(issues[0]?.message).toContain("insert");
    expect(issues[0]?.message).toContain("update");
    expect(issues[0]?.message).toContain("delete");
    expect(issues[0]?.message).not.toContain("select,");
  });
});
