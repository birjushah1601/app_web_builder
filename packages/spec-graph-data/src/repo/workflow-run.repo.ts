import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  workflowRuns,
  type NewWorkflowRunRow,
  type WorkflowRunRow
} from "../schema/workflow-runs.js";

export class WorkflowRunRepo {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async insert(input: NewWorkflowRunRow): Promise<WorkflowRunRow> {
    const [row] = await this.db.insert(workflowRuns).values(input).returning();
    if (!row) {
      throw new Error("WorkflowRunRepo.insert: insert returned no row");
    }
    return row;
  }

  async findById(id: string): Promise<WorkflowRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .limit(1);
    return row;
  }

  async listOpenForProject(projectId: string): Promise<WorkflowRunRow[]> {
    return this.db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.projectId, projectId),
          inArray(workflowRuns.status, ["running", "awaiting_approval"])
        )
      )
      .orderBy(desc(workflowRuns.createdAt));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({ status, updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }

  async updateDependencyProfile(id: string, dependencyProfile: unknown): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({ dependencyProfile: dependencyProfile as WorkflowRunRow["dependencyProfile"], updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }
}
