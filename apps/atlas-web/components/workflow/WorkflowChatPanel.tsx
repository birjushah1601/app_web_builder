"use client";

import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

export interface WorkflowChatPanelProps {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}

// Plan C Task 8 wires planner Q&A history, completion summary, and a
// free-text follow-up box. Today this renders a read-only prompt so the
// client shell layout is final and the right-rail width is reserved.
export function WorkflowChatPanel({ snapshot }: WorkflowChatPanelProps) {
  return (
    <aside
      data-testid="workflow-chat-panel"
      className="hidden w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50 md:flex"
    >
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
        Workflow chat
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs text-slate-700">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
          Original prompt
        </div>
        <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2">
          {snapshot.prompt}
        </div>
        <div className="mt-3 text-[10px] italic text-slate-500">
          Q&amp;A history + follow-up land in Plan C Task 8.
        </div>
      </div>
    </aside>
  );
}
