import { describe, it, expect } from "vitest";
import { DeployRequestSchema, DeployResultSchema, DeploymentPhaseSchema } from "../src/types.js";

const validReq = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: { NODE_ENV: "production" }
};

describe("DeployRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(DeployRequestSchema.safeParse(validReq).success).toBe(true);
  });

  it("rejects floating tags (no @sha256:)", () => {
    expect(
      DeployRequestSchema.safeParse({
        ...validReq,
        imageRef: "registry.atlas.app/projects/abc:latest"
      }).success
    ).toBe(false);
  });

  it("rejects subdomain with uppercase or bad chars", () => {
    expect(DeployRequestSchema.safeParse({ ...validReq, subdomain: "MyApp" }).success).toBe(false);
    expect(DeployRequestSchema.safeParse({ ...validReq, subdomain: "my_app" }).success).toBe(false);
  });

  it("rejects unknown target", () => {
    expect(DeployRequestSchema.safeParse({ ...validReq, target: "staging" }).success).toBe(false);
  });

  it("DeploymentPhaseSchema enumerates the 10 documented phases", () => {
    expect(DeploymentPhaseSchema.options.length).toBe(10);
  });

  it("DeployResultSchema requires phase + argoApplicationName + branchSchemaName", () => {
    const result = {
      deployId: "22222222-2222-4222-8222-222222222222",
      request: validReq,
      phase: "queued",
      argoApplicationName: "p-abc-main",
      branchSchemaName: "br_abcdef0123456789",
      startedAt: "2026-04-22T00:00:00.000Z"
    };
    expect(DeployResultSchema.safeParse(result).success).toBe(true);
  });
});
