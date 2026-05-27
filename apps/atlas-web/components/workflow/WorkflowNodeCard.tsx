"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@atlas/workflow-engine";
import { nodeStatusColor } from "@/lib/workflow/useNodeStatusColor";

export type WorkflowNodeData = {
  node: WorkflowNode;
  projectId: string;
  workflowRunId: string;
  onOpenMenu: (nodeId: string, anchor: HTMLElement) => void;
};

// xyflow custom node type — receives the WorkflowNodeData in `data`
export function WorkflowNodeCard({ data }: NodeProps) {
  const { node, onOpenMenu } = data as WorkflowNodeData;

  return (
    <div
      data-testid={`workflow-node-${node.id}`}
      className={`min-w-[180px] rounded-md border-2 px-3 py-2 text-xs ${nodeStatusColor(node.status)}`}
    >
      {/* Incoming edge handle (top) */}
      <Handle type="target" position={Position.Top} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{node.summary}</div>
          <div className="text-[10px] opacity-70 mt-0.5 font-mono">{node.artifactKind}</div>
        </div>

        {/* Context menu trigger */}
        <button
          type="button"
          aria-label={`Node menu for ${node.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(node.id, e.currentTarget as HTMLElement);
          }}
          className="px-1 text-base leading-none hover:opacity-70 shrink-0"
        >
          ⋯
        </button>
      </div>

      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-60">{node.status}</div>

      {node.policy.runMode === "background" && (
        <div className="mt-1 text-[10px]">🔔 will notify</div>
      )}

      {/* Outgoing edge handle (bottom) */}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
