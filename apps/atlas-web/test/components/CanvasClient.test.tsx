import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasClient } from "@/components/CanvasClient.js";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
    onPaneClick
  }: {
    nodes: Array<{ id: string }>;
    onNodeClick?: (e: unknown, n: { id: string }) => void;
    onPaneClick?: () => void;
  }) => (
    <div data-testid="rf-mock">
      <div data-testid="rf-count">{nodes.length} nodes</div>
      {nodes.map((n) => (
        <button
          key={n.id}
          data-testid={`rf-node-${n.id}`}
          onClick={() => onNodeClick?.(null, n)}
        >
          {n.id}
        </button>
      ))}
      <button data-testid="rf-pane-click" onClick={() => onPaneClick?.()}>
        pane
      </button>
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e
}));

const baseGraph = {
  nodes: {
    "page:home": {
      kind: "page",
      id: "page:home",
      path: "/",
      title: "Home",
      renderMode: "ssr",
      routeRef: "GET /"
    },
    "page:about": {
      kind: "page",
      id: "page:about",
      path: "/about",
      title: "About",
      renderMode: "ssr",
      routeRef: "GET /about"
    }
  },
  edges: []
};

describe("CanvasClient", () => {
  it("renders one React-Flow node per Spec Graph node", () => {
    render(<CanvasClient graph={baseGraph as never} projectId="p-1" />);
    expect(screen.getByTestId("rf-count")).toHaveTextContent("2 nodes");
  });

  it("shows hint text in side panel before any node is selected", () => {
    render(<CanvasClient graph={baseGraph as never} projectId="p-1" />);
    expect(screen.getByTestId("selected-node-panel")).toHaveTextContent(/click a node/i);
  });

  it("displays selected node metadata when a node is clicked", () => {
    render(<CanvasClient graph={baseGraph as never} projectId="p-1" />);
    fireEvent.click(screen.getByTestId("rf-node-page:home"));
    const panel = screen.getByTestId("selected-node-panel");
    expect(panel).toHaveTextContent("page:home");
    expect(panel).toHaveTextContent("kind: page");
  });

  it("flags AST mapping as deferred in the side panel", () => {
    render(<CanvasClient graph={baseGraph as never} projectId="p-1" />);
    fireEvent.click(screen.getByTestId("rf-node-page:home"));
    expect(screen.getByTestId("selected-node-panel")).toHaveTextContent(/AST mapping/i);
  });

  it("clears selection when the pane is clicked", () => {
    render(<CanvasClient graph={baseGraph as never} projectId="p-1" />);
    fireEvent.click(screen.getByTestId("rf-node-page:home"));
    expect(screen.getByTestId("selected-node-panel")).toHaveTextContent("page:home");
    fireEvent.click(screen.getByTestId("rf-pane-click"));
    expect(screen.getByTestId("selected-node-panel")).toHaveTextContent(/click a node/i);
  });
});
