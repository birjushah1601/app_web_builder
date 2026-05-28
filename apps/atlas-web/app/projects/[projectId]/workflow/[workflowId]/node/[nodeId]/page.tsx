import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkflowRun } from "@/lib/actions/getWorkflowRun";
import { CanvasShellWired } from "@/components/canvas/CanvasShellWired";
import "@/components/canvas/register-renderers";

export default async function WorkflowNodePage({
  params
}: {
  params: Promise<{ projectId: string; workflowId: string; nodeId: string }>;
}) {
  const { projectId, workflowId, nodeId } = await params;
  const snapshot = await getWorkflowRun({ projectId, workflowRunId: workflowId });
  if (!snapshot || snapshot.projectId !== projectId) notFound();

  const node = snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) notFound();

  const hasRitual = typeof node.ritualId === "string" && node.ritualId.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workflow-node-page">
      <nav
        className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs"
        data-testid="workflow-node-breadcrumb"
      >
        <Link
          href={`/projects/${projectId}/workflow/${workflowId}`}
          className="text-indigo-600 hover:underline"
        >
          ← Workflow
        </Link>
        <span className="text-slate-400">/</span>
        <span className="font-semibold text-slate-800">{node.summary}</span>
        <span className="font-mono text-[10px] text-slate-500">
          ({node.artifactKind})
        </span>
        <span
          data-testid="workflow-node-status"
          className="ml-auto rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
        >
          {node.status}
        </span>
      </nav>

      <div className="flex min-h-0 flex-1">
        {hasRitual ? (
          <CanvasShellWired
            projectId={projectId}
            persona="ama"
            ritualIdOverride={node.ritualId}
          />
        ) : (
          <div
            data-testid="workflow-node-not-started"
            className="flex flex-1 items-center justify-center p-8 text-sm text-slate-600"
          >
            Node hasn&apos;t started yet (status: {node.status}). The per-node view
            will populate once the ritual launches.
          </div>
        )}
      </div>
    </div>
  );
}
