import { notFound } from "next/navigation";
import { getWorkflowRun } from "@/lib/actions/getWorkflowRun";
import { WorkflowGraphClient } from "@/components/workflow/WorkflowGraphClient";

export default async function WorkflowPage({
  params
}: {
  params: Promise<{ projectId: string; workflowId: string }>;
}) {
  const { projectId, workflowId } = await params;
  const snapshot = await getWorkflowRun({ projectId, workflowRunId: workflowId });
  if (!snapshot) notFound();
  if (snapshot.projectId !== projectId) notFound();
  return <WorkflowGraphClient initial={snapshot} projectId={projectId} />;
}
