import { describe, it, expect } from "vitest";
import { WorkflowNodeSchema, type DeployResult } from "../src/types.js";

describe("WorkflowNodeSchema — deployResult field (Plan F.2)", () => {
  const base = {
    id: "deploy",
    artifactKind: "deploy",
    summary: "deploy",
    dependsOn: ["iac"],
    consumes: ["iac"],
    policy: { priority: 0, runMode: "active" as const },
    status: "done" as const
  };

  it("accepts a valid deployResult", () => {
    const validResult: DeployResult = {
      deployId: "d-1",
      publicUrl: "https://proj-1.atlas.dev",
      argoApplicationName: "proj-1-main",
      branchSchemaName: "branch_main",
      appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
      phase: "healthy",
      startedAt: "2026-01-01T00:00:00.000Z"
    };
    const r = WorkflowNodeSchema.safeParse({ ...base, deployResult: validResult });
    expect(r.success).toBe(true);
  });

  it("accepts omitted deployResult (default state for nodes that haven't deployed)", () => {
    expect(WorkflowNodeSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a 'failed' phase deployResult", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "https://x.atlas.dev",
        argoApplicationName: "x", branchSchemaName: "branch_x",
        appliedManifests: [], phase: "failed", startedAt: "x"
      }
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid publicUrl", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "not-a-url",
        argoApplicationName: "x", branchSchemaName: "x",
        appliedManifests: [], phase: "healthy", startedAt: "x"
      }
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown phase value", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "https://x.atlas.dev",
        argoApplicationName: "x", branchSchemaName: "x",
        appliedManifests: [], phase: "pending", startedAt: "x"
      }
    });
    expect(r.success).toBe(false);
  });

  it("rejects appliedManifests entries with empty namespace/kind/name", () => {
    const r = WorkflowNodeSchema.safeParse({
      ...base,
      deployResult: {
        deployId: "d-1", publicUrl: "https://x.atlas.dev",
        argoApplicationName: "x", branchSchemaName: "x",
        appliedManifests: [{ namespace: "", kind: "Service", name: "api" }],
        phase: "healthy", startedAt: "x"
      }
    });
    expect(r.success).toBe(false);
  });
});
