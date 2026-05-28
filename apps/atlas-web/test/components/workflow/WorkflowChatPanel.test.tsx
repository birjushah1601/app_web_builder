import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

const { startWorkflowMock, routerPush } = vi.hoisted(() => ({
  startWorkflowMock: vi.fn(),
  routerPush: vi.fn()
}));

vi.mock("@/lib/actions/startWorkflow", () => ({ startWorkflow: startWorkflowMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/components/ritual/TriageClarificationsLive", () => ({
  TriageClarificationsLive: () => <div data-testid="mock-triage" />
}));

import { WorkflowChatPanel } from "@/components/workflow/WorkflowChatPanel";

function makeSnapshot(
  status: WorkflowRunSnapshot["status"] = "running",
  overrides?: Partial<WorkflowRunSnapshot>
): WorkflowRunSnapshot {
  return {
    id: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    prompt: "Build a todo app",
    status,
    nodes: [
      {
        id: "n1",
        artifactKind: "backend-rest-api",
        summary: "Built the API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "done"
      },
      {
        id: "n2",
        artifactKind: "frontend-app",
        summary: "Built the UI",
        dependsOn: ["n1"],
        consumes: ["n1"],
        policy: { priority: 0, runMode: "active" },
        status: "done"
      }
    ],
    edges: [{ from: "n1", to: "n2" }],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  startWorkflowMock.mockReset();
  routerPush.mockReset();
});

describe("WorkflowChatPanel", () => {
  it("renders the original prompt", () => {
    render(<WorkflowChatPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-chat-prompt")).toHaveTextContent(
      "Build a todo app"
    );
  });

  it("mounts the TriageClarificationsLive widget for planner Q&A", () => {
    render(<WorkflowChatPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("mock-triage")).toBeInTheDocument();
  });

  it("hides the completion summary while still running", () => {
    render(<WorkflowChatPanel snapshot={makeSnapshot("running")} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-completion-summary")).toBeNull();
  });

  it("shows the completion summary listing every node when completed", () => {
    render(<WorkflowChatPanel snapshot={makeSnapshot("completed")} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-completion-summary")).toBeInTheDocument();
    expect(screen.getByTestId("completion-node-n1")).toHaveTextContent("Built the API");
    expect(screen.getByTestId("completion-node-n2")).toHaveTextContent("Built the UI");
  });

  it("disables submit when the input is empty", () => {
    render(<WorkflowChatPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-chat-submit")).toBeDisabled();
  });

  it("starts a new workflow and navigates on submit", async () => {
    startWorkflowMock.mockResolvedValue({ workflowRunId: "run-2" });
    render(<WorkflowChatPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.change(screen.getByTestId("workflow-chat-input"), {
      target: { value: "Add a billing module" }
    });
    fireEvent.click(screen.getByTestId("workflow-chat-submit"));
    await waitFor(() => {
      expect(startWorkflowMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        prompt: "Add a billing module"
      });
    });
    expect(routerPush).toHaveBeenCalledWith("/projects/proj-1/workflow/run-2");
  });

  it("surfaces errors from startWorkflow", async () => {
    startWorkflowMock.mockRejectedValue(new Error("nope"));
    render(<WorkflowChatPanel snapshot={makeSnapshot()} projectId="proj-1" />);
    fireEvent.change(screen.getByTestId("workflow-chat-input"), {
      target: { value: "x" }
    });
    fireEvent.click(screen.getByTestId("workflow-chat-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-chat-error")).toHaveTextContent("nope");
    });
    expect(routerPush).not.toHaveBeenCalled();
  });
});
