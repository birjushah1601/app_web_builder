/**
 * WorkflowNodeContextMenu unit tests.
 *
 * Verifies that the correct menu items appear for different node statuses
 * and that action callbacks are invoked when clicked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { WorkflowNode } from "@atlas/workflow-engine";

// ---------------------------------------------------------------------------
// Mock server actions
// vi.mock is hoisted before variable declarations, so use vi.fn() inline and
// retrieve the mock references after import.
// ---------------------------------------------------------------------------
vi.mock("@/lib/actions/retryNode", () => ({ retryNode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/actions/setNodePolicy", () => ({ setNodePolicy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/actions/deferNode", () => ({ deferNode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/actions/resumeDeferredNode", () => ({ resumeDeferredNode: vi.fn().mockResolvedValue(undefined) }));

// ---------------------------------------------------------------------------
// Mock next/link
// ---------------------------------------------------------------------------
vi.mock("next/link", () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  )
}));

import { WorkflowNodeContextMenu } from "@/components/workflow/WorkflowNodeContextMenu";
import { retryNode as _retryNode } from "@/lib/actions/retryNode";
import { setNodePolicy as _setNodePolicy } from "@/lib/actions/setNodePolicy";
import { deferNode as _deferNode } from "@/lib/actions/deferNode";
import { resumeDeferredNode as _resumeDeferredNode } from "@/lib/actions/resumeDeferredNode";

const mockRetryNode = _retryNode as ReturnType<typeof vi.fn>;
const mockSetNodePolicy = _setNodePolicy as ReturnType<typeof vi.fn>;
const mockDeferNode = _deferNode as ReturnType<typeof vi.fn>;
const mockResumeDeferredNode = _resumeDeferredNode as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    artifactKind: "frontend-app",
    summary: "Build frontend",
    dependsOn: [],
    consumes: [],
    policy: { priority: 0, runMode: "active" },
    status: "pending",
    ...overrides
  };
}

/** Minimal anchor stub: returns a rect matching the given position */
function makeAnchor(top = 100, left = 200, bottom = 120): HTMLElement {
  const anchor = document.createElement("button");
  Object.defineProperty(anchor, "getBoundingClientRect", {
    value: () => ({ top, left, bottom, right: left + 30, width: 30, height: 20 })
  });
  // Simulate being inside a workflow-graph container
  const parent = document.createElement("div");
  parent.dataset["testid"] = "workflow-graph";
  Object.defineProperty(parent, "getBoundingClientRect", {
    value: () => ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 })
  });
  parent.appendChild(anchor);
  document.body.appendChild(parent);
  return anchor;
}

function renderMenu(node: WorkflowNode, onClose = vi.fn()) {
  const anchor = makeAnchor();
  render(
    <WorkflowNodeContextMenu
      projectId="proj-1"
      workflowRunId="run-1"
      nodeId={node.id}
      node={node}
      anchor={anchor}
      onClose={onClose}
    />
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowNodeContextMenu", () => {
  it("always renders 'Open ritual logs' link", () => {
    renderMenu(makeNode());
    const link = screen.getByRole("link", { name: /open ritual logs/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/projects/proj-1/workflow/run-1/node/node-1");
  });

  it("does NOT render Retry when status is 'done'", () => {
    renderMenu(makeNode({ status: "done" }));
    expect(screen.queryByRole("menuitem", { name: /retry node/i })).toBeNull();
  });

  it("renders Retry only when status is 'failed'", () => {
    renderMenu(makeNode({ status: "failed" }));
    expect(screen.getByRole("menuitem", { name: /retry node/i })).toBeInTheDocument();
  });

  it("always renders Prioritize, Run in background, Defer, Skip permanently", () => {
    renderMenu(makeNode());
    expect(screen.getByRole("menuitem", { name: /prioritize/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /run in background/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /defer/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /skip permanently/i })).toBeInTheDocument();
  });

  it("shows 'Resume from deferred' when runMode=deferred", () => {
    renderMenu(makeNode({ policy: { priority: 0, runMode: "deferred" } }));
    expect(screen.getByRole("menuitem", { name: /resume from deferred/i })).toBeInTheDocument();
    // Normal "Defer" button should be gone when already deferred
    expect(screen.queryByRole("menuitem", { name: /^defer$/i })).toBeNull();
  });

  it("shows 'Switch to Active' when runMode=background", () => {
    renderMenu(makeNode({ policy: { priority: 0, runMode: "background" } }));
    expect(screen.getByRole("menuitem", { name: /switch to active/i })).toBeInTheDocument();
  });

  it("Skip permanently is disabled with (Plan G) label", () => {
    renderMenu(makeNode());
    const btn = screen.getByRole("menuitem", { name: /skip permanently/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Plan G");
  });

  it("Retry node calls retryNode action and closes menu", async () => {
    const { onClose } = renderMenu(makeNode({ status: "failed" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /retry node/i }));
    expect(mockRetryNode).toHaveBeenCalledWith({
      projectId: "proj-1",
      workflowRunId: "run-1",
      nodeId: "node-1"
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Prioritize calls setNodePolicy with priority:100 and closes menu", async () => {
    const { onClose } = renderMenu(makeNode());
    await userEvent.click(screen.getByRole("menuitem", { name: /prioritize/i }));
    expect(mockSetNodePolicy).toHaveBeenCalledWith({
      projectId: "proj-1",
      workflowRunId: "run-1",
      nodeId: "node-1",
      policy: { priority: 100 }
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Run in background calls setNodePolicy with runMode=background and closes", async () => {
    const { onClose } = renderMenu(makeNode({ policy: { priority: 0, runMode: "active" } }));
    await userEvent.click(screen.getByRole("menuitem", { name: /run in background/i }));
    expect(mockSetNodePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { runMode: "background" } })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Switch to Active calls setNodePolicy with runMode=active and closes", async () => {
    const { onClose } = renderMenu(makeNode({ policy: { priority: 0, runMode: "background" } }));
    await userEvent.click(screen.getByRole("menuitem", { name: /switch to active/i }));
    expect(mockSetNodePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { runMode: "active" } })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Defer calls deferNode and closes", async () => {
    const { onClose } = renderMenu(makeNode({ policy: { priority: 0, runMode: "active" } }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^defer$/i }));
    expect(mockDeferNode).toHaveBeenCalledWith({
      projectId: "proj-1",
      workflowRunId: "run-1",
      nodeId: "node-1"
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Resume from deferred calls resumeDeferredNode and closes", async () => {
    const { onClose } = renderMenu(makeNode({ policy: { priority: 0, runMode: "deferred" } }));
    await userEvent.click(screen.getByRole("menuitem", { name: /resume from deferred/i }));
    expect(mockResumeDeferredNode).toHaveBeenCalledWith({
      projectId: "proj-1",
      workflowRunId: "run-1",
      nodeId: "node-1"
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes menu on Escape keydown", async () => {
    const { onClose } = renderMenu(makeNode());
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
