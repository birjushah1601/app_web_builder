"use client";

import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

export interface WorkflowApprovalPanelProps {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}

// Plan C Task 7 fleshes this out with inline edits (rename / runMode /
// priority) and an Approve button wired to approveWorkflowPlan(). For now
// the panel is a thin marker so the client shell can mount conditionally
// without breaking imports.
export function WorkflowApprovalPanel({ snapshot }: WorkflowApprovalPanelProps) {
  return (
    <div
      data-testid="workflow-approval-panel"
      className="absolute right-3 top-3 z-10 w-64 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-md"
    >
      <div className="mb-1 font-semibold">Plan ready for approval</div>
      <div className="opacity-80">
        {snapshot.nodes.length} node{snapshot.nodes.length === 1 ? "" : "s"} proposed.
        Inline edits + Approve land in Plan C Task 7.
      </div>
    </div>
  );
}
