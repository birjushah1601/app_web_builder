import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { useWorkflowRun } from "@/lib/workflow/useWorkflowRun";
import { EventStreamCtxForTesting } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides?: Partial<WorkflowRunSnapshot>): WorkflowRunSnapshot {
  return {
    id: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    prompt: "Build a todo app",
    status: "running",
    nodes: [
      {
        id: "node-a",
        artifactKind: "frontend-app",
        summary: "Build frontend",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "node-b",
        artifactKind: "backend-rest-api",
        summary: "Build backend",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ],
    edges: [],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  id = "evt-1"
): RitualEvent {
  return {
    id,
    projectId: "proj-1",
    ritualId: "run-1",
    type: type as RitualEvent["type"],
    payload,
    ts: Date.now()
  };
}

function withEventStream(events: RitualEvent[]) {
  return ({ children }: { children: React.ReactNode }) => (
    <EventStreamCtxForTesting.Provider
      value={{ events, status: "open", lastEventId: null }}
    >
      {children}
    </EventStreamCtxForTesting.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkflowRun", () => {
  it("returns the initial snapshot unchanged when there are no matching events", () => {
    const initial = makeSnapshot();
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream([])
    });
    expect(result.current.status).toBe("running");
    expect(result.current.nodes[0]!.status).toBe("pending");
  });

  it("applies workflow.run.status_changed to snapshot.status", () => {
    const initial = makeSnapshot({ status: "running" });
    const events = [
      makeEvent("workflow.run.status_changed", { workflowRunId: "run-1", status: "completed" })
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    expect(result.current.status).toBe("completed");
  });

  it("ignores workflow.run.status_changed for a different workflowRunId", () => {
    const initial = makeSnapshot({ status: "running" });
    const events = [
      makeEvent("workflow.run.status_changed", { workflowRunId: "run-OTHER", status: "aborted" })
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    expect(result.current.status).toBe("running"); // unchanged
  });

  it("applies workflow.node.status_changed to the correct node", () => {
    const initial = makeSnapshot();
    const events = [
      makeEvent(
        "workflow.node.status_changed",
        { workflowRunId: "run-1", nodeId: "node-a", status: "running" },
        "evt-2"
      )
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    expect(result.current.nodes.find((n) => n.id === "node-a")!.status).toBe("running");
    // node-b is untouched
    expect(result.current.nodes.find((n) => n.id === "node-b")!.status).toBe("pending");
  });

  it("applies multiple node status events in order", () => {
    const initial = makeSnapshot();
    const events = [
      makeEvent(
        "workflow.node.status_changed",
        { workflowRunId: "run-1", nodeId: "node-a", status: "running" },
        "evt-1"
      ),
      makeEvent(
        "workflow.node.status_changed",
        { workflowRunId: "run-1", nodeId: "node-a", status: "done" },
        "evt-2"
      )
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    // Last event wins
    expect(result.current.nodes.find((n) => n.id === "node-a")!.status).toBe("done");
  });

  it("propagates ritualId + failure from node event payload", () => {
    const initial = makeSnapshot();
    const failure = { error: "timeout", attempts: 2 };
    const events = [
      makeEvent(
        "workflow.node.status_changed",
        {
          workflowRunId: "run-1",
          nodeId: "node-b",
          status: "failed",
          ritualId: "ritual-xyz",
          failure
        },
        "evt-3"
      )
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    const nodeB = result.current.nodes.find((n) => n.id === "node-b")!;
    expect(nodeB.status).toBe("failed");
    expect(nodeB.ritualId).toBe("ritual-xyz");
    expect(nodeB.failure).toEqual(failure);
  });

  it("ignores node event for unknown nodeId (does not throw)", () => {
    const initial = makeSnapshot();
    const events = [
      makeEvent(
        "workflow.node.status_changed",
        { workflowRunId: "run-1", nodeId: "node-UNKNOWN", status: "done" }
      )
    ];
    const { result } = renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    // Should not throw and nodes unchanged
    expect(result.current.nodes.every((n) => n.status === "pending")).toBe(true);
  });

  it("does not mutate the initial snapshot object", () => {
    const initial = makeSnapshot();
    const originalStatus = initial.status;
    const originalNodeStatus = initial.nodes[0]!.status;
    const events = [
      makeEvent("workflow.run.status_changed", { workflowRunId: "run-1", status: "completed" })
    ];
    renderHook(() => useWorkflowRun(initial), {
      wrapper: withEventStream(events)
    });
    // initial must not be mutated
    expect(initial.status).toBe(originalStatus);
    expect(initial.nodes[0]!.status).toBe(originalNodeStatus);
  });
});
