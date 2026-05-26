export interface CheckpointWriter {
  append(input: {
    workflowRunId: string;
    nodeId: string;
    kind: string;
    payload: unknown;
    ritualEventId?: string;
  }): Promise<void>;
}

const CHECKPOINT_EVENT_TYPES = new Set([
  "architect.pass1.completed",
  "architect.pass2.completed",
  "researcher.brief.completed",
  "designer.draft.completed",
  "designer.critique.completed",
  "designer.revise.completed",
  "designer.proposal.completed",
  "canvas.option.selected",
  "ritual.triage.clarification_resolved",
  "sandbox.apply.completed",
  "asset.gen.completed"
]);

const DEVELOPER_DELTA_BATCH_SIZE = 50;

export class CheckpointRecorder {
  private deltaCounters = new Map<string, number>(); // ritualId → count

  constructor(
    private readonly writer: CheckpointWriter,
    private readonly ritualToNode: Map<string, { workflowRunId: string; nodeId: string }>
  ) {}

  async onEvent(event: { type: string; ritualId: string; payload?: unknown; ritualEventId?: string }): Promise<void> {
    const mapping = this.ritualToNode.get(event.ritualId);
    if (!mapping) return;

    if (CHECKPOINT_EVENT_TYPES.has(event.type)) {
      await this.writer.append({
        workflowRunId: mapping.workflowRunId,
        nodeId: mapping.nodeId,
        kind: event.type,
        payload: event.payload ?? {},
        ...(event.ritualEventId && { ritualEventId: event.ritualEventId })
      });
    } else if (event.type === "developer.candidate.delta") {
      const cur = (this.deltaCounters.get(event.ritualId) ?? 0) + 1;
      this.deltaCounters.set(event.ritualId, cur);
      if (cur % DEVELOPER_DELTA_BATCH_SIZE === 0) {
        await this.writer.append({
          workflowRunId: mapping.workflowRunId,
          nodeId: mapping.nodeId,
          kind: "developer_candidate_delta_batch",
          payload: { batchedDeltaCount: cur }
        });
      }
    }
  }

  registerRitualForNode(ritualId: string, workflowRunId: string, nodeId: string): void {
    this.ritualToNode.set(ritualId, { workflowRunId, nodeId });
  }
}
