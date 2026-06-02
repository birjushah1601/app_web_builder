import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

const { abortWorkflowMock } = vi.hoisted(() => ({ abortWorkflowMock: vi.fn() }));
vi.mock("@/lib/actions/abortWorkflow", () => ({ abortWorkflow: abortWorkflowMock }));

const { retryAllMock: hoistedRetryAllMock } = vi.hoisted(() => ({
  retryAllMock: vi.fn()
}));
vi.mock("@/lib/actions/retryAllFailedNodes", () => ({
  retryAllFailedNodes: hoistedRetryAllMock
}));

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

describe("WorkflowHeader — Plan G cost + retry-all", () => {
  beforeEach(() => {
    hoistedRetryAllMock.mockReset();
  });

  it("renders running cost when snapshot.totalCostUsd is set", () => {
    const snap = makeSnapshot("running", { totalCostUsd: 1.234567 });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-running-cost")).toHaveTextContent(/\$1\.23/);
  });

  it("renders running cost / cap when both totalCostUsd and costCapUsd are set", () => {
    const snap = makeSnapshot("running", { totalCostUsd: 2.5, costCapUsd: 5.0 });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    const display = screen.getByTestId("workflow-running-cost");
    expect(display).toHaveTextContent(/\$2\.50/);
    expect(display).toHaveTextContent(/\$5\.00/);
  });

  it("flips amber at 80% of cap", () => {
    const snap = makeSnapshot("running", { totalCostUsd: 4.1, costCapUsd: 5.0 });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-running-cost").className).toMatch(/amber/);
  });

  it("flips red at 100% of cap", () => {
    const snap = makeSnapshot("running", { totalCostUsd: 5.1, costCapUsd: 5.0 });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-running-cost").className).toMatch(/red/);
  });

  it("does NOT render the retry-all button when status is not escalated", () => {
    const snap = makeSnapshot("running");
    snap.nodes = [
      {
        id: "n1",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "failed"
      }
    ];
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-retry-all-btn")).toBeNull();
  });

  it("does NOT render retry-all when escalated but no failed nodes", () => {
    const snap = makeSnapshot("escalated");
    snap.nodes = [
      {
        id: "n1",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "done"
      }
    ];
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-retry-all-btn")).toBeNull();
  });

  it("renders retry-all-failed(N) button when escalated with failed nodes", () => {
    const snap = makeSnapshot("escalated");
    snap.nodes = [
      {
        id: "n1",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "failed"
      },
      {
        id: "n2",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "failed"
      },
      {
        id: "n3",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "done"
      }
    ];
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    const btn = screen.getByTestId("workflow-retry-all-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/retry all failed/i);
    expect(btn).toHaveTextContent(/2/);
  });

  it("does NOT render the cost breakdown disclosure when costBreakdown is undefined (Plan G.3)", () => {
    const snap = makeSnapshot("running", { totalCostUsd: 1.0 });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-cost-breakdown")).toBeNull();
  });

  it("does NOT render the cost breakdown disclosure when costBreakdown is empty (Plan G.3)", () => {
    const snap = makeSnapshot("running", {
      totalCostUsd: 1.0,
      costBreakdown: []
    });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-cost-breakdown")).toBeNull();
  });

  it("renders the cost breakdown disclosure listing roles sorted by totalUsd desc (Plan G.3)", () => {
    const snap = makeSnapshot("running", {
      totalCostUsd: 2.7,
      costBreakdown: [
        { roleId: "developer", totalUsd: 2.13, callCount: 12 },
        { roleId: "architect", totalUsd: 0.45, callCount: 3 },
        { roleId: "tester", totalUsd: 0.12, callCount: 1 }
      ]
    });
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    const disclosure = screen.getByTestId("workflow-cost-breakdown");
    expect(disclosure).toBeInTheDocument();
    // expect order developer → architect → tester (already passed sorted by engine)
    const rows = disclosure.querySelectorAll("[data-testid='workflow-cost-breakdown-row']");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/developer/);
    expect(rows[0]).toHaveTextContent(/\$2\.13/);
    expect(rows[0]).toHaveTextContent(/12/);
    expect(rows[1]).toHaveTextContent(/architect/);
    expect(rows[1]).toHaveTextContent(/\$0\.45/);
    expect(rows[2]).toHaveTextContent(/tester/);
    expect(rows[2]).toHaveTextContent(/\$0\.12/);
  });

  it("calls retryAllFailedNodes on click", async () => {
    hoistedRetryAllMock.mockResolvedValue({ retriedCount: 2, errors: [] });
    const snap = makeSnapshot("escalated");
    snap.nodes = [
      {
        id: "n1",
        artifactKind: "x",
        summary: "s",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "failed"
      }
    ];
    render(<WorkflowHeader snapshot={snap} projectId="proj-1" />);
    fireEvent.click(screen.getByTestId("workflow-retry-all-btn"));
    await waitFor(() => {
      expect(hoistedRetryAllMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        workflowRunId: "run-1"
      });
    });
  });
});
