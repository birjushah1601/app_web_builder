import { describe, expect, it } from "vitest";
import { ModelSchema } from "../../src/nodes/model.js";

const valid = {
  kind: "model" as const,
  id: "model:User",
  name: "User",
  fields: { id: "uuid", email: "string" },
  relations: [{ name: "posts", to: "Post", kind: "one-to-many" }],
  indexes: [{ on: ["email"], unique: true }],
  rlsPolicies: {
    select: "auth.uid() = id",
    insert: "auth.uid() = id",
    update: "auth.uid() = id",
    delete: "auth.uid() = id"
  },
  piiClassification: "direct",
  dataRetentionDays: 365
};

describe("ModelSchema", () => {
  it("accepts valid model", () => {
    expect(() => ModelSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => ModelSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("requires fields", () => {
    expect(() => ModelSchema.parse({ ...valid, fields: undefined })).toThrow();
  });
  it("rlsPolicies allows partial coverage", () => {
    expect(() =>
      ModelSchema.parse({ ...valid, rlsPolicies: { select: "true" } })
    ).not.toThrow();
  });
  it("piiClassification accepts the four levels", () => {
    for (const level of ["none", "indirect", "direct", "sensitive"]) {
      expect(() => ModelSchema.parse({ ...valid, piiClassification: level })).not.toThrow();
    }
  });
  it("dataRetentionDays must be positive when present", () => {
    expect(() => ModelSchema.parse({ ...valid, dataRetentionDays: -1 })).toThrow();
  });
});
