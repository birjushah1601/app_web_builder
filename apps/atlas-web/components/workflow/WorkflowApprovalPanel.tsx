"use client";

import { useMemo, useState, useTransition } from "react";
import type { WorkflowRunSnapshot, WorkflowNode } from "@atlas/workflow-engine";
import { approveWorkflowPlan } from "@/lib/actions/approveWorkflowPlan";

export interface WorkflowApprovalPanelProps {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}

type RunMode = WorkflowNode["policy"]["runMode"];

interface NodeDraft {
  summary: string;
  priority: number;
  runMode: RunMode;
}

function toDraft(node: WorkflowNode): NodeDraft {
  return {
    summary: node.summary,
    priority: node.policy.priority,
    runMode: node.policy.runMode
  };
}

interface PendingEdit {
  nodeId: string;
  policy?: { priority?: number; runMode?: RunMode };
  summary?: string;
}

function buildEdits(
  original: WorkflowNode[],
  drafts: Record<string, NodeDraft>
): PendingEdit[] {
  const out: PendingEdit[] = [];
  for (const node of original) {
    const d = drafts[node.id];
    if (!d) continue;
    const edit: PendingEdit = { nodeId: node.id };
    if (d.summary !== node.summary) edit.summary = d.summary;
    const policy: NonNullable<PendingEdit["policy"]> = {};
    if (d.priority !== node.policy.priority) policy.priority = d.priority;
    if (d.runMode !== node.policy.runMode) policy.runMode = d.runMode;
    if (Object.keys(policy).length > 0) edit.policy = policy;
    if (edit.summary !== undefined || edit.policy !== undefined) {
      out.push(edit);
    }
  }
  return out;
}

export function WorkflowApprovalPanel({
  snapshot,
  projectId
}: WorkflowApprovalPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, NodeDraft>>(() =>
    Object.fromEntries(snapshot.nodes.map((n) => [n.id, toDraft(n)]))
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pendingEdits = useMemo(
    () => buildEdits(snapshot.nodes, drafts),
    [snapshot.nodes, drafts]
  );

  const updateDraft = (nodeId: string, patch: Partial<NodeDraft>) => {
    setDrafts((cur) => ({ ...cur, [nodeId]: { ...cur[nodeId]!, ...patch } }));
  };

  const onApprove = () => {
    setError(null);
    startTransition(async () => {
      try {
        await approveWorkflowPlan({
          projectId,
          workflowRunId: snapshot.id,
          edits: pendingEdits.length > 0 ? pendingEdits : undefined
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div
      data-testid="workflow-approval-panel"
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-96 flex-col rounded-md border border-amber-300 bg-white text-xs shadow-lg"
    >
      <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
        <div className="font-semibold text-amber-900">Approve plan</div>
        <div className="mt-0.5 text-[11px] text-amber-800">
          {snapshot.nodes.length} node{snapshot.nodes.length === 1 ? "" : "s"} proposed.
          Adjust below, then approve to start the workflow.
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <ul className="space-y-3">
          {snapshot.nodes.map((node) => {
            const draft = drafts[node.id]!;
            return (
              <li
                key={node.id}
                data-testid={`approval-row-${node.id}`}
                className="rounded-md border border-slate-200 bg-slate-50 p-2"
              >
                <div className="font-mono text-[10px] text-slate-500">
                  {node.id} · {node.artifactKind}
                </div>
                <label className="mt-1 block">
                  <span className="sr-only">Summary for {node.id}</span>
                  <input
                    aria-label={`Summary for ${node.id}`}
                    data-testid={`approval-summary-${node.id}`}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    value={draft.summary}
                    onChange={(e) =>
                      updateDraft(node.id, { summary: e.target.value })
                    }
                  />
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1">
                    <span className="text-[10px] uppercase text-slate-600">Mode</span>
                    <select
                      aria-label={`Run mode for ${node.id}`}
                      data-testid={`approval-runmode-${node.id}`}
                      className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
                      value={draft.runMode}
                      onChange={(e) =>
                        updateDraft(node.id, { runMode: e.target.value as RunMode })
                      }
                    >
                      <option value="active">active</option>
                      <option value="background">background</option>
                      <option value="deferred">deferred</option>
                    </select>
                  </label>
                  <label className="ml-auto flex items-center gap-1">
                    <span className="text-[10px] uppercase text-slate-600">Priority</span>
                    <input
                      type="number"
                      aria-label={`Priority for ${node.id}`}
                      data-testid={`approval-priority-${node.id}`}
                      className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
                      value={draft.priority}
                      min={0}
                      onChange={(e) =>
                        updateDraft(node.id, {
                          priority: Number.parseInt(e.target.value, 10) || 0
                        })
                      }
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between border-t border-amber-200 bg-amber-50 px-3 py-2">
        <div className="text-[11px] text-amber-800">
          {pendingEdits.length === 0
            ? "No edits"
            : `${pendingEdits.length} edit${pendingEdits.length === 1 ? "" : "s"} pending`}
        </div>
        <button
          type="button"
          data-testid="workflow-approve-btn"
          onClick={onApprove}
          disabled={pending}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {pending ? "Approving…" : "Approve"}
        </button>
      </div>
      {error && (
        <div
          data-testid="workflow-approve-error"
          className="border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  );
}
