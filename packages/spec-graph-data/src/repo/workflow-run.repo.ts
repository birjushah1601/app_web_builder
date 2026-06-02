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

  /**
   * Plan G.2 — set or clear the per-run USD cost cap. Passing `undefined`
   * writes NULL (cap removed). Numeric column accepts a number on write;
   * drizzle stringifies before sending to Postgres.
   */
  async updateCostCap(id: string, costCapUsd: number | undefined): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({
        // drizzle numeric accepts string | null on write; number is rejected by
        // the column type. Use toString() to keep precision exact.
        costCapUsd: costCapUsd === undefined ? null : String(costCapUsd),
        updatedAt: new Date()
      })
      .where(eq(workflowRuns.id, id));
  }

  /**
   * Plan G.2 — freeze the workflow's final USD cost onto the run row.
   * Called by WorkflowEngine.buildSchedulerDeps.onSchedulerExit before the
   * per-run LLMUsageTracker is released, so buildSnapshot can surface a
   * stable totalCostUsd after terminal status.
   */
  async updateTotalCostUsd(id: string, totalCostUsd: number): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({
        totalCostUsd: String(totalCostUsd),
        updatedAt: new Date()
      })
      .where(eq(workflowRuns.id, id));
  }
}
