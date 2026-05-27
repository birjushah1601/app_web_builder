/**
 * WorkflowGraph render test.
 *
 * @xyflow/react relies on ResizeObserver + SVG layout methods that are absent
 * in jsdom. We mock the entire package so the test focuses on WorkflowGraph's
 * own responsibilities: mapping snapshot nodes to rendered WorkflowNodeCards
 * and wiring the context menu state.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

// ---------------------------------------------------------------------------
// Mock @xyflow/react — provide just enough surface that WorkflowGraph renders
// ---------------------------------------------------------------------------
vi.mock("@xyflow/react", () => {
  const ReactFlow = ({
    children,
    nodes
  }: {
    children?: React.ReactNode;
    nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
  }) => (
    <div data-testid="xyflow-mock">
      {/* Render each node's data.node via the nodeTypes resolver by calling
          WorkflowNodeCard directly — WorkflowGraph passes it as nodeTypes. */}
      {nodes.map((n) => {
        // The data prop passed to each node by WorkflowGraph is WorkflowNodeData.
        // To keep the mock simple, we just expose the node id on the DOM.
        return (
          <div key={n.id} data-node-id={n.id} data-node-type={n.type}>
            {/* Render children of ReactFlow (Background, Controls) */}
          </div>
        );
      })}
      {children}
    </div>
  );

  const Background = () => <div data-testid="background" />;
  const Controls = () => <div data-testid="controls" />;

  const Handle = ({ type, position }: { type: string; position: string }) => (
    <div data-handle-type={type} data-handle-position={position} />
  );

  const Position = { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } as const;

  return { ReactFlow, Background, Controls, Handle, Position };
});

// ---------------------------------------------------------------------------
// Also stub the xyflow CSS import (jsdom doesn't process CSS)
// ---------------------------------------------------------------------------
vi.mock("@xyflow/react/dist/style.css", () => ({}));

// ---------------------------------------------------------------------------
// Mock server actions (they use "use server" — not importable in jsdom)
// ---------------------------------------------------------------------------
vi.mock("@/lib/actions/retryNode", () => ({ retryNode: vi.fn() }));
vi.mock("@/lib/actions/setNodePolicy", () => ({ setNodePolicy: vi.fn() }));
vi.mock("@/lib/actions/deferNode", () => ({ deferNode: vi.fn() }));
vi.mock("@/lib/actions/resumeDeferredNode", () => ({ resumeDeferredNode: vi.fn() }));

// ---------------------------------------------------------------------------
// Mock next/link
// ---------------------------------------------------------------------------
vi.mock("next/link", () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  )
}));

// Now import the component under test (after mocks are set up)
import { WorkflowGraph } from "@/components/workflow/WorkflowGraph";

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
        dependsOn: ["node-a"],
        consumes: ["node-a"],
        policy: { priority: 0, runMode: "active" },
        status: "running"
      }
    ],
    edges: [{ from: "node-a", to: "node-b" }],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowGraph", () => {
  it("renders the outer workflow-graph container", () => {
    render(<WorkflowGraph snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("workflow-graph")).toBeInTheDocument();
  });

  it("passes both nodes to ReactFlow with type='workflow'", () => {
    render(<WorkflowGraph snapshot={makeSnapshot()} projectId="proj-1" />);
    const nodeA = document.querySelector("[data-node-id='node-a']");
    const nodeB = document.querySelector("[data-node-id='node-b']");
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA?.getAttribute("data-node-type")).toBe("workflow");
    expect(nodeB?.getAttribute("data-node-type")).toBe("workflow");
  });

  it("renders Background and Controls inside ReactFlow", () => {
    render(<WorkflowGraph snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.getByTestId("background")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
  });

  it("does not render the context menu until a node opens it", () => {
    render(<WorkflowGraph snapshot={makeSnapshot()} projectId="proj-1" />);
    expect(screen.queryByTestId("workflow-node-context-menu")).toBeNull();
  });
});
