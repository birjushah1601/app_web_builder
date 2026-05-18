import { describe, expect, it } from "vitest";
import {
  ProjectIdSchema,
  NodeIdSchema,
  EdgeIdSchema,
  PiiClassificationSchema,
  ExtensionsSchema,
  parseNodeKindFromId,
  NODE_KINDS
} from "../src/primitives.js";
import { SpecGraphSchema } from "../src/graph.js";

describe("primitives", () => {
  describe("ProjectIdSchema", () => {
    it("accepts a v4 UUID", () => {
      expect(() => ProjectIdSchema.parse("11111111-1111-4111-8111-111111111111")).not.toThrow();
    });
    it("rejects non-UUID strings", () => {
      expect(() => ProjectIdSchema.parse("not-a-uuid")).toThrow();
    });
  });

  describe("NodeIdSchema", () => {
    it("accepts <kind>:<id> shape with known kind", () => {
      expect(() => NodeIdSchema.parse("page:home")).not.toThrow();
      expect(() => NodeIdSchema.parse("component:Button")).not.toThrow();
      expect(() => NodeIdSchema.parse("compliance:baseline")).not.toThrow();
    });
    it("rejects unknown kind prefix", () => {
      expect(() => NodeIdSchema.parse("widget:foo")).toThrow();
    });
    it("rejects missing colon", () => {
      expect(() => NodeIdSchema.parse("home")).toThrow();
    });
    it("rejects empty id segment", () => {
      expect(() => NodeIdSchema.parse("page:")).toThrow();
    });
  });

  describe("PiiClassificationSchema", () => {
    it("accepts the four known levels", () => {
      for (const level of ["none", "indirect", "direct", "sensitive"]) {
        expect(() => PiiClassificationSchema.parse(level)).not.toThrow();
      }
    });
    it("rejects unknown levels", () => {
      expect(() => PiiClassificationSchema.parse("super-secret")).toThrow();
    });
  });

  describe("ExtensionsSchema", () => {
    it("accepts an empty object", () => {
      expect(ExtensionsSchema.parse({})).toEqual({});
    });
    it("accepts arbitrary unknown values (lenient)", () => {
      const ext = { customField: { nested: 42 }, otherKey: "string" };
      expect(ExtensionsSchema.parse(ext)).toEqual(ext);
    });
  });

  describe("parseNodeKindFromId", () => {
    it("returns the kind segment", () => {
      expect(parseNodeKindFromId("page:home")).toBe("page");
      expect(parseNodeKindFromId("component:Button")).toBe("component");
    });
  });

  describe("EdgeIdSchema", () => {
    it("accepts an opaque non-empty string", () => {
      expect(() => EdgeIdSchema.parse("e1")).not.toThrow();
    });
    it("rejects empty", () => {
      expect(() => EdgeIdSchema.parse("")).toThrow();
    });
  });

  describe("v1.1 additions", () => {
    it("NODE_KINDS includes 5 new infra kinds", () => {
      expect(NODE_KINDS).toContain("region");
      expect(NODE_KINDS).toContain("dataresidency");
      expect(NODE_KINDS).toContain("runtime");
      expect(NODE_KINDS).toContain("provider");
      expect(NODE_KINDS).toContain("workloadtopology");
    });

    it("SpecGraphSchema accepts schemaVersion 1.1.0 and still accepts 1.0.0", () => {
      const base = {
        projectId: "00000000-0000-4000-8000-000000000000",
        name: "n",
        complianceClasses: ["baseline"],
        databaseProvider: {
          tier: "atlas-run" as const,
          provider: "neon",
          region: "us-east-1",
          connectionStringRef: "ref"
        },
        templateDigest: "sha256:abcdef",
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
        nodes: {},
        edges: []
      };
      expect(SpecGraphSchema.safeParse({ schemaVersion: "1.0.0", ...base }).success).toBe(true);
      expect(SpecGraphSchema.safeParse({ schemaVersion: "1.1.0", ...base }).success).toBe(true);
      expect(SpecGraphSchema.safeParse({ schemaVersion: "2.0.0", ...base }).success).toBe(false);
    });
  });
});
