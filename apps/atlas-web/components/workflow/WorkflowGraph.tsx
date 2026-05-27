"use client";

import { useMemo, useState, useCallback } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowRunSnapshot, WorkflowNode } from "@atlas/workflow-engine";
import { WorkflowNodeCard, type WorkflowNodeData } from "./WorkflowNodeCard";
import { WorkflowNodeContextMenu } from "./WorkflowNodeContextMenu";

const nodeTypes = { workflow: WorkflowNodeCard };

// Horizontal spacing between nodes in the same topo-rank column.
const CELL_W = 240;
// Vertical spacing between ranks.
const CELL_H = 140;
// Number of nodes per row when no dependency structure is present.
const GRID_COLS = 4;

export function WorkflowGraph({
  snapshot,
  projectId
}: {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}) {
  const [menuFor, setMenuFor] = useState<{
    nodeId: string;
    anchor: HTMLElement;
  } | null>(null);

  const openMenu = useCallback((nodeId: string, anchor: HTMLElement) => {
    setMenuFor({ nodeId, anchor });
  }, []);

  const nodes: Node<WorkflowNodeData>[] = useMemo(() => {
    const sorted = topoSort(snapshot.nodes);
    return sorted.map((n, i) => ({
      id: n.id,
      type: "workflow",
      // Crude grid layout — dagre/elkjs upgrade is a Plan C polish task.
      position: { x: (i % GRID_COLS) * CELL_W, y: Math.floor(i / GRID_COLS) * CELL_H },
      data: {
        node: n,
        projectId,
        workflowRunId: snapshot.id,
        onOpenMenu: openMenu
      }
    }));
  }, [snapshot, projectId, openMenu]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const n of snapshot.nodes) {
      for (const dep of n.dependsOn) {
        out.push({ id: `${dep}->${n.id}`, source: dep, target: n.id });
      }
    }
    return out;
  }, [snapshot]);

  const menuNode = menuFor
    ? snapshot.nodes.find((n) => n.id === menuFor.nodeId) ?? null
    : null;

  return (
    <div data-testid="workflow-graph" className="h-full w-full relative">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Background />
        <Controls />
      </ReactFlow>

      {menuFor && menuNode && (
        <WorkflowNodeContextMenu
          projectId={projectId}
          workflowRunId={snapshot.id}
          nodeId={menuFor.nodeId}
          anchor={menuFor.anchor}
          node={menuNode}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm).
// Returns nodes in dependency order; nodes with no inbound edges come first.
// Falls back to original order if a cycle is detected (graceful degradation).
// ---------------------------------------------------------------------------
function topoSort<T extends { id: string; dependsOn: string[] }>(nodes: T[]): T[] {
  const idMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      // Only count dependencies that exist in this snapshot (guard against
      // stale references after partial edits during the approval phase).
      if (idMap.has(dep)) {
        inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      }
    }
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const sorted: T[] = [];

  while (queue.length > 0) {
    const n = queue.shift()!;
    sorted.push(n);
    for (const m of nodes) {
      if (m.dependsOn.includes(n.id)) {
        const d = (inDegree.get(m.id) ?? 0) - 1;
        inDegree.set(m.id, d);
        if (d === 0) queue.push(m);
      }
    }
  }

  // Cycle detected — fall back to original order.
  if (sorted.length < nodes.length) {
    return nodes;
  }

  return sorted;
}
