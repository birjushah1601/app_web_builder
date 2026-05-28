/**
 * WorkflowGraphClient composition test.
 *
 * The client wires together useWorkflowRun + Header + ApprovalPanel (conditional)
 * + Graph + ChatPanel. We mock each child to a marker so this test only verifies
 * composition + the awaiting_approval branch.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

vi.mock("@/lib/workflow/useWorkflowRun", () => ({
  useWorkflowRun: (snap: WorkflowRunSnapshot) => snap
}));

vi.mock("@/components/workflow/WorkflowGraph", () => ({
  WorkflowGraph: () => <div data-testid="mock-graph" />
}));
vi.mock("@/components/workflow/WorkflowHeader", () => ({
  WorkflowHeader: ({ snapshot }: { snapshot: WorkflowRunSnapshot }) => (
    <div data-testid="mock-header">{snapshot.status}</div>
  )
}));
vi.mock("@/components/workflow/WorkflowApprovalPanel", () => ({
  WorkflowApprovalPanel: () => <div data-testid="mock-approval" />
}));
vi.mock("@/components/workflow/WorkflowChatPanel", () => ({
  WorkflowChatPanel: () => <div data-testid="mock-chat" />
}));

import { WorkflowGraphClient } from "@/components/workflow/WorkflowGraphClient";

function makeSnapshot(status: WorkflowRunSnapshot["status"]): WorkflowRunSnapshot {
  return {
    id: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    prompt: "p",
    status,
    nodes: [],
    edges: [],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("WorkflowGraphClient", () => {
  it("renders header, graph, and chat panel always", () => {
    render(<WorkflowGraphClient initial={makeSnapshot("running")} projectId="proj-1" />);
    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-graph")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chat")).toBeInTheDocument();
  });

  it("renders the approval panel only when status === awaiting_approval", () => {
    const { rerender } = render(
      <WorkflowGraphClient initial={makeSnapshot("running")} projectId="proj-1" />
    );
    expect(screen.queryByTestId("mock-approval")).toBeNull();

    rerender(
      <WorkflowGraphClient
        initial={makeSnapshot("awaiting_approval")}
        projectId="proj-1"
      />
    );
    expect(screen.getByTestId("mock-approval")).toBeInTheDocument();
  });
});
