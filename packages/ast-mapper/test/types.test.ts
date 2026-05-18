import { describe, it, expect } from "vitest";
import { AstRangeSchema, MutationProposalSchema, AstMapFileSchema } from "../src/types.js";

const validRange = {
  file: "src/Hero.tsx",
  startLine: 10,
  startColumn: 0,
  endLine: 25,
  endColumn: 1
};

describe("AstRangeSchema", () => {
  it("accepts a valid range", () => {
    expect(AstRangeSchema.safeParse(validRange).success).toBe(true);
  });
  it("rejects 0-line", () => {
    expect(AstRangeSchema.safeParse({ ...validRange, startLine: 0 }).success).toBe(false);
  });
  it("rejects negative column", () => {
    expect(AstRangeSchema.safeParse({ ...validRange, startColumn: -1 }).success).toBe(false);
  });
});

describe("MutationProposalSchema", () => {
  it("accepts create-node with newValue", () => {
    expect(
      MutationProposalSchema.safeParse({
        kind: "create-node",
        targetRef: "page:about",
        newValue: { kind: "page" }
      }).success
    ).toBe(true);
  });

  it("rejects update-node-field without fieldPath", () => {
    expect(
      MutationProposalSchema.safeParse({
        kind: "update-node-field",
        targetRef: "page:home",
        newValue: "/new-path"
      }).success
    ).toBe(false);
  });

  it("rejects create-node without newValue", () => {
    expect(
      MutationProposalSchema.safeParse({
        kind: "create-node",
        targetRef: "page:x"
      }).success
    ).toBe(false);
  });

  it("accepts delete-node without newValue or fieldPath", () => {
    expect(
      MutationProposalSchema.safeParse({
        kind: "delete-node",
        targetRef: "page:old"
      }).success
    ).toBe(true);
  });
});

describe("AstMapFileSchema", () => {
  it("accepts a valid map file", () => {
    expect(
      AstMapFileSchema.safeParse({
        version: 1,
        graphHash: "sha256:" + "a".repeat(64),
        generatedAt: "2026-04-21T12:00:00.000Z",
        mappings: [
          {
            nodeId: "page:home",
            ranges: [validRange],
            confidence: 1.0,
            producer: "ts-compiler@5.6.3"
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects bad graphHash", () => {
    expect(
      AstMapFileSchema.safeParse({
        version: 1,
        graphHash: "abc",
        generatedAt: "2026-04-21T12:00:00.000Z",
        mappings: []
      }).success
    ).toBe(false);
  });
});
