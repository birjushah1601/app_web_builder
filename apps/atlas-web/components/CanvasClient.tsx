"use client";

import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface CanvasGraphNode {
  kind: string;
  id: string;
  [key: string]: unknown;
}

export interface CanvasGraphEdge {
  from: string;
  to: string;
  type: string;
}

export interface CanvasClientProps {
  graph: { nodes: Record<string, CanvasGraphNode>; edges: CanvasGraphEdge[] };
  projectId: string;
}

export function CanvasClient({ graph }: CanvasClientProps) {
  const [nodes, setNodes] = useState<Node[]>(() =>
    Object.values(graph.nodes).map((n, i) => ({
      id: n.id,
      type: "default",
      data: { label: `${n.kind}: ${n.id}` },
      position: { x: (i % 5) * 220, y: Math.floor(i / 5) * 140 }
    }))
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    graph.edges.map((e, i) => ({ id: `e-${i}`, source: e.from, target: e.to, label: e.type }))
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)),
    []
  );
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => setSelectedNodeId(node.id),
    []
  );
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedGraphNode = useMemo(
    () => (selectedNodeId ? graph.nodes[selectedNodeId] : null),
    [selectedNodeId, graph.nodes]
  );

  return (
    <div className="flex h-[calc(100vh-7rem)]">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <SelectedNodePanel node={selectedGraphNode} />
    </div>
  );
}

function SelectedNodePanel({ node }: { node: CanvasGraphNode | null }) {
  if (!node) {
    return (
      <aside
        className="w-80 border-l border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600"
        data-testid="selected-node-panel"
      >
        Click a node to inspect.
      </aside>
    );
  }
  return (
    <aside
      className="w-80 border-l border-zinc-200 bg-zinc-50 p-4 text-sm"
      data-testid="selected-node-panel"
    >
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Selected node</div>
        <div className="font-mono text-base text-zinc-900">{node.id}</div>
        <div className="text-xs text-zinc-600">kind: {node.kind}</div>
      </div>
      <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        AST mapping: not yet wired (B-3 alpha — TS Compiler integration deferred).
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-700">Raw node JSON</summary>
        <pre className="mt-2 overflow-auto rounded bg-zinc-900 p-2 text-zinc-100">
          {JSON.stringify(node, null, 2)}
        </pre>
      </details>
    </aside>
  );
}
