import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

const { approveMock } = vi.hoisted(() => ({ approveMock: vi.fn() }));
vi.mock("@/lib/actions/approveWorkflowPlan", () => ({
  approveWorkflowPlan: approveMock
}));

import { WorkflowApprovalPanel } from "@/components/workflow/WorkflowApprovalPanel";

function makeSnapshot(): WorkflowRunSnapshot {
  return {
    id: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    prompt: "p",
    status: "awaiting_approval",
    nodes: [
      {
        id: "n1",
        artifactKind: "backend-rest-api",
        summary: "Build the API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "n2",
        artifactKind: "frontend-app",
        summary: "Build the UI",
        dependsOn: ["n1"],
        consumes: ["n1"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ],
    edges: [{ from: "n1", to: "n2" }],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

beforeEach(() => {
  approveMock.mockReset();
});

describe("WorkflowApprovalPanel", () => {
  it("renders an editable row per node", () => {
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("approval-row-n1")).toBeInTheDocument();
    expect(screen.getByTestId("approval-row-n2")).toBeInTheDocument();
    expect(screen.getByTestId("approval-summary-n1")).toHaveValue("Build the API");
  });

  it("shows 'No edits' when nothing has changed", () => {
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByText(/no edits/i)).toBeInTheDocument();
  });

  it("counts pending edits when fields change", () => {
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.change(screen.getByTestId("approval-summary-n1"), {
      target: { value: "Renamed API" }
    });
    fireEvent.change(screen.getByTestId("approval-runmode-n2"), {
      target: { value: "background" }
    });
    expect(screen.getByText(/2 edits pending/i)).toBeInTheDocument();
  });

  it("calls approveWorkflowPlan with edits on Approve", async () => {
    approveMock.mockResolvedValue(undefined);
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.change(screen.getByTestId("approval-summary-n1"), {
      target: { value: "Renamed API" }
    });
    fireEvent.change(screen.getByTestId("approval-priority-n2"), {
      target: { value: "5" }
    });
    fireEvent.click(screen.getByTestId("workflow-approve-btn"));
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledTimes(1);
    });
    const call = approveMock.mock.calls[0]![0];
    expect(call.projectId).toBe("proj-1");
    expect(call.workflowRunId).toBe("run-1");
    expect(call.edits).toEqual([
      { nodeId: "n1", summary: "Renamed API" },
      { nodeId: "n2", policy: { priority: 5 } }
    ]);
  });

  it("calls approve with no edits payload when nothing changed", async () => {
    approveMock.mockResolvedValue(undefined);
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("workflow-approve-btn"));
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledTimes(1);
    });
    const call = approveMock.mock.calls[0]![0];
    expect(call.edits).toBeUndefined();
  });

  it("surfaces server errors", async () => {
    approveMock.mockRejectedValue(new Error("boom"));
    render(<WorkflowApprovalPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("workflow-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-approve-error")).toHaveTextContent("boom");
    });
  });
});
