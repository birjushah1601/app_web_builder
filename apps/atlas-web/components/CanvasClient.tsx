"use client";

import { useState, useCallback } from "react";
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface CanvasClientProps {
  graph: { nodes: Record<string, { kind: string; id: string } & Record<string, unknown>>; edges: Array<{ from: string; to: string; type: string }> };
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

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)), []);

  return (
    <div className="h-[calc(100vh-7rem)]">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
