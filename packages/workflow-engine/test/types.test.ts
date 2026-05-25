import { describe, it, expect } from "vitest";
import {
  NodePolicySchema,
  WorkflowNodeSchema,
  WorkflowRunSchema,
  type WorkflowNode,
  type WorkflowRun
} from "../src/types.js";

describe("Workflow Zod types", () => {
  it("NodePolicySchema accepts active runMode with priority 0", () => {
    const ok = NodePolicySchema.safeParse({ priority: 0, runMode: "active" });
    expect(ok.success).toBe(true);
  });

  it("NodePolicySchema rejects invalid runMode", () => {
    const bad = NodePolicySchema.safeParse({ priority: 0, runMode: "weird" });
    expect(bad.success).toBe(false);
  });

  it("WorkflowNodeSchema validates a minimal pending node", () => {
    const ok = WorkflowNodeSchema.safeParse({
      id: "n1",
      artifactKind: "frontend-app",
      summary: "Build the landing page",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    });
    expect(ok.success).toBe(true);
  });

  it("WorkflowNodeSchema rejects consumes that's not a subset of dependsOn", () => {
    const node: WorkflowNode = {
      id: "n2",
      artifactKind: "frontend-app",
      summary: "x",
      dependsOn: ["n1"],
      consumes: ["n1", "n99"], // n99 not in dependsOn
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    };
    const result = WorkflowNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });

  it("WorkflowRunSchema accepts a minimal run", () => {
    const run: WorkflowRun = {
      id: "00000000-0000-0000-0000-000000000001",
      projectId: "00000000-0000-0000-0000-000000000002",
      userId: "user_test",
      prompt: "Build me a SaaS",
      status: "planning",
      nodes: [],
      edges: [],
      dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const ok = WorkflowRunSchema.safeParse(run);
    expect(ok.success).toBe(true);
  });
});
