import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  workflowNodes,
  type NewWorkflowNodeRow,
  type WorkflowNodeRow
} from "../schema/workflow-nodes.js";

export interface UpdateStatusOpts {
  ritualId?: string;
  startedAt?: Date;
  completedAt?: Date;
  failure?: unknown;
}

export class WorkflowNodeRepo {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async insertMany(rows: NewWorkflowNodeRow[]): Promise<WorkflowNodeRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(workflowNodes).values(rows).returning();
  }

  async findByRunId(runId: string): Promise<WorkflowNodeRow[]> {
    return this.db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowRunId, runId));
  }

  async findOne(runId: string, nodeId: string): Promise<WorkflowNodeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workflowNodes)
      .where(and(eq(workflowNodes.workflowRunId, runId), eq(workflowNodes.id, nodeId)))
      .limit(1);
    return row;
  }

  async updateStatus(
    runId: string,
    nodeId: string,
    status: string,
    opts?: UpdateStatusOpts
  ): Promise<void> {
    await this.db
      .update(workflowNodes)
      .set({
        status,
        ...(opts?.ritualId !== undefined && { ritualId: opts.ritualId }),
        ...(opts?.startedAt !== undefined && { startedAt: opts.startedAt }),
        ...(opts?.completedAt !== undefined && { completedAt: opts.completedAt }),
        ...(opts?.failure !== undefined && { failure: opts.failure })
      })
      .where(and(eq(workflowNodes.workflowRunId, runId), eq(workflowNodes.id, nodeId)));
  }

  async setArtifact(
    runId: string,
    nodeId: string,
    artifact: unknown,
    schemaVersion: string
  ): Promise<void> {
    await this.db
      .update(workflowNodes)
      .set({ artifact, artifactSchemaVersion: schemaVersion })
      .where(and(eq(workflowNodes.workflowRunId, runId), eq(workflowNodes.id, nodeId)));
  }

  async updatePolicy(runId: string, nodeId: string, policy: unknown): Promise<void> {
    await this.db
      .update(workflowNodes)
      .set({ policy })
      .where(and(eq(workflowNodes.workflowRunId, runId), eq(workflowNodes.id, nodeId)));
  }
}
