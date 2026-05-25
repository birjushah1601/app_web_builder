import { describe, it, expect } from "vitest";
import type { RoleInvocation } from "@atlas/conductor";
import { StubWorkflowPlannerRole } from "../src/stub-planner-role.js";

describe("StubWorkflowPlannerRole", () => {
  const role = new StubWorkflowPlannerRole();

  const createInvocation = (priorArtifact?: unknown): RoleInvocation => ({
    ritualId: "test-ritual-123",
    intent: "Plan a workflow",
    graphSlice: { bytes: "test", hash: "abc123" },
    userTurn: "Build a React app",
    priorArtifact
  });

  it("has correct role id", () => {
    expect(role.id).toBe("workflow-planner");
  });

  it("returns event with correct eventType workflow_planner.dag.emitted", async () => {
    const inv = createInvocation();
    const output = await role.run(inv);
    expect(output.events).toHaveLength(1);
    expect(output.events[0]!.eventType).toBe("workflow_planner.dag.emitted");
  });

  it("returns diff with kind 'none'", async () => {
    const inv = createInvocation();
    const output = await role.run(inv);
    expect(output.diff.kind).toBe("none");
  });

  it("emits a 1-node DAG", async () => {
    const inv = createInvocation();
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ id: string; artifactKind: string; summary: string }>;
    };
    expect(payload.nodes).toHaveLength(1);
  });

  it("node has correct structure", async () => {
    const inv = createInvocation();
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{
        id: string;
        artifactKind: string;
        summary: string;
        dependsOn: string[];
        consumes: string[];
        policy: { priority: number; runMode: string };
      }>;
    };
    const node = payload.nodes[0]!;
    expect(node.id).toBe("n1");
    expect(node.dependsOn).toEqual([]);
    expect(node.consumes).toEqual([]);
    expect(node.policy.priority).toBe(0);
    expect(node.policy.runMode).toBe("active");
  });

  it("uses suggestedKinds[0] from priorArtifact when provided", async () => {
    const inv = createInvocation({
      suggestedKinds: ["backend-rest-api", "frontend-app"]
    });
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ artifactKind: string; summary: string }>;
    };
    const node = payload.nodes[0]!;
    expect(node.artifactKind).toBe("backend-rest-api");
    expect(node.summary).toBe("Build the backend-rest-api");
  });

  it("defaults to 'frontend-app' when priorArtifact is null", async () => {
    const inv = createInvocation(null);
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ artifactKind: string; summary: string }>;
    };
    const node = payload.nodes[0]!;
    expect(node.artifactKind).toBe("frontend-app");
    expect(node.summary).toBe("Build the frontend-app");
  });

  it("defaults to 'frontend-app' when priorArtifact is undefined", async () => {
    const inv = createInvocation(undefined);
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ artifactKind: string; summary: string }>;
    };
    const node = payload.nodes[0]!;
    expect(node.artifactKind).toBe("frontend-app");
    expect(node.summary).toBe("Build the frontend-app");
  });

  it("defaults to 'frontend-app' when suggestedKinds is missing", async () => {
    const inv = createInvocation({ otherField: "value" });
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ artifactKind: string; summary: string }>;
    };
    const node = payload.nodes[0]!;
    expect(node.artifactKind).toBe("frontend-app");
    expect(node.summary).toBe("Build the frontend-app");
  });

  it("defaults to 'frontend-app' when suggestedKinds is empty", async () => {
    const inv = createInvocation({ suggestedKinds: [] });
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      nodes: Array<{ artifactKind: string; summary: string }>;
    };
    const node = payload.nodes[0]!;
    expect(node.artifactKind).toBe("frontend-app");
    expect(node.summary).toBe("Build the frontend-app");
  });

  it("includes dependencyProfile with schemaVersion '1'", async () => {
    const inv = createInvocation();
    const output = await role.run(inv);
    const payload = output.events[0]!.payload as {
      dependencyProfile: { schemaVersion: string };
    };
    expect(payload.dependencyProfile.schemaVersion).toBe("1");
  });
});
