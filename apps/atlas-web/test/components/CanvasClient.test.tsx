import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasClient } from "@/components/CanvasClient.js";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: unknown[] }) => (
    <div data-testid="rf-mock">{nodes.length} nodes</div>
  ),
  Background: () => null,
  Controls: () => null,
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e
}));

describe("CanvasClient", () => {
  it("renders one React-Flow node per Spec Graph node", () => {
    const graph = {
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" },
        "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" }
      },
      edges: []
    };
    render(<CanvasClient graph={graph as never} projectId="p-1" />);
    expect(screen.getByTestId("rf-mock")).toHaveTextContent("2 nodes");
  });
});
