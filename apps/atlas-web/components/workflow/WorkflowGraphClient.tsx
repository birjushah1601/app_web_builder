"use client";

import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";
import { useWorkflowRun } from "@/lib/workflow/useWorkflowRun";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowHeader } from "./WorkflowHeader";
import { WorkflowApprovalPanel } from "./WorkflowApprovalPanel";
import { WorkflowChatPanel } from "./WorkflowChatPanel";

export interface WorkflowGraphClientProps {
  initial: WorkflowRunSnapshot;
  projectId: string;
}

/**
 * Top-level client component for the workflow view. Subscribes the SSE
 * stream via useWorkflowRun(initial) and composes header + approval +
 * graph + chat panels. The page route owns server-side fetch + auth; this
 * component is purely the live-rendering shell.
 */
export function WorkflowGraphClient({ initial, projectId }: WorkflowGraphClientProps) {
  const snapshot = useWorkflowRun(initial);
  const showApproval = snapshot.status === "awaiting_approval";

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workflow-graph-client">
      <WorkflowHeader snapshot={snapshot} projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          {showApproval && (
            <WorkflowApprovalPanel snapshot={snapshot} projectId={projectId} />
          )}
          <WorkflowGraph snapshot={snapshot} projectId={projectId} />
        </div>
        <WorkflowChatPanel snapshot={snapshot} projectId={projectId} />
      </div>
    </div>
  );
}
