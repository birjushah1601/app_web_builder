import { asc, eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  workflowNodeCheckpoints,
  type NewWorkflowCheckpointRow,
  type WorkflowCheckpointRow
} from "../schema/workflow-node-checkpoints.js";

export class WorkflowCheckpointRepo {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async append(row: NewWorkflowCheckpointRow): Promise<WorkflowCheckpointRow> {
    const [inserted] = await this.db
      .insert(workflowNodeCheckpoints)
      .values(row)
      .returning();
    if (!inserted) {
      throw new Error("WorkflowCheckpointRepo.append: insert returned no row");
    }
    return inserted;
  }

  async listForNode(runId: string, nodeId: string): Promise<WorkflowCheckpointRow[]> {
    return this.db
      .select()
      .from(workflowNodeCheckpoints)
      .where(
        and(
          eq(workflowNodeCheckpoints.workflowRunId, runId),
          eq(workflowNodeCheckpoints.nodeId, nodeId)
        )
      )
      .orderBy(asc(workflowNodeCheckpoints.createdAt));
  }

  async listForRun(runId: string): Promise<WorkflowCheckpointRow[]> {
    return this.db
      .select()
      .from(workflowNodeCheckpoints)
      .where(eq(workflowNodeCheckpoints.workflowRunId, runId))
      .orderBy(asc(workflowNodeCheckpoints.createdAt));
  }
}
