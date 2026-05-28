"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";
import { startWorkflow } from "@/lib/actions/startWorkflow";
import { TriageClarificationsLive } from "@/components/ritual/TriageClarificationsLive";

export interface WorkflowChatPanelProps {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}

export function WorkflowChatPanel({ snapshot, projectId }: WorkflowChatPanelProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    const prompt = draft.trim();
    if (!prompt) return;
    setError(null);
    startTransition(async () => {
      try {
        const { workflowRunId } = await startWorkflow({ projectId, prompt });
        setDraft("");
        router.push(`/projects/${projectId}/workflow/${workflowRunId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const completion =
    snapshot.status === "completed" ? snapshot.nodes : null;

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
        <div
          data-testid="workflow-chat-prompt"
          className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2"
        >
          {snapshot.prompt}
        </div>

        <div className="mt-3">
          <TriageClarificationsLive />
        </div>

        {completion && (
          <section
            data-testid="workflow-completion-summary"
            className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
              Workflow completed
            </div>
            <ul className="space-y-1 text-[11px]">
              {completion.map((n) => (
                <li
                  key={n.id}
                  data-testid={`completion-node-${n.id}`}
                  className="flex items-start gap-2"
                >
                  <span className="font-mono text-[10px] text-emerald-800">
                    {n.artifactKind}
                  </span>
                  <span className="flex-1 text-slate-800">{n.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-2">
        <label className="block text-[10px] uppercase tracking-wide text-slate-500">
          <span className="sr-only">Follow-up prompt</span>
          Follow-up
        </label>
        <textarea
          data-testid="workflow-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Refine or start a new workflow run from this project…"
          className="mt-1 w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-xs"
          disabled={pending}
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            Submitting creates a new workflow run.
          </span>
          <button
            type="button"
            data-testid="workflow-chat-submit"
            onClick={onSubmit}
            disabled={pending || draft.trim().length === 0}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? "Starting…" : "Start run"}
          </button>
        </div>
        {error && (
          <div
            data-testid="workflow-chat-error"
            className="mt-1 text-[11px] text-red-700"
          >
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
