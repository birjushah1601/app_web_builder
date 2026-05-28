import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

const { abortWorkflowMock } = vi.hoisted(() => ({ abortWorkflowMock: vi.fn() }));
vi.mock("@/lib/actions/abortWorkflow", () => ({ abortWorkflow: abortWorkflowMock }));

import { WorkflowHeader } from "@/components/workflow/WorkflowHeader";

function makeSnapshot(
  status: WorkflowRunSnapshot["status"],
  overrides?: Partial<WorkflowRunSnapshot>
): WorkflowRunSnapshot {
  return {
    id: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    prompt: "Build a todo app",
    status,
    nodes: [],
    edges: [],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  abortWorkflowMock.mockReset();
});

describe("WorkflowHeader", () => {
  it("renders the prompt as the title", () => {
    render(<WorkflowHeader snapshot={makeSnapshot("running")} projectId="proj-1" />);
    expect(screen.getByText("Build a todo app")).toBeInTheDocument();
  });

  it("shows the status badge with humanised text", () => {
    render(
      <WorkflowHeader snapshot={makeSnapshot("awaiting_approval")} projectId="proj-1" />
    );
    expect(screen.getByTestId("workflow-status-badge")).toHaveTextContent(
      /awaiting approval/i
    );
  });

  it("renders the abort button for running workflows", () => {
    render(<WorkflowHeader snapshot={makeSnapshot("running")} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-abort-btn")).toBeInTheDocument();
  });

  it("hides the abort button for completed workflows", () => {
    render(<WorkflowHeader snapshot={makeSnapshot("completed")} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-abort-btn")).toBeNull();
  });

  it("calls abortWorkflow with projectId + workflowRunId on click", async () => {
    abortWorkflowMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WorkflowHeader snapshot={makeSnapshot("running")} projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("workflow-abort-btn"));
    await waitFor(() => {
      expect(abortWorkflowMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        workflowRunId: "run-1"
      });
    });
    confirmSpy.mockRestore();
  });

  it("surfaces abort errors next to the button", async () => {
    abortWorkflowMock.mockRejectedValue(new Error("nope"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WorkflowHeader snapshot={makeSnapshot("running")} projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("workflow-abort-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-abort-error")).toHaveTextContent("nope");
    });
    confirmSpy.mockRestore();
  });
});
