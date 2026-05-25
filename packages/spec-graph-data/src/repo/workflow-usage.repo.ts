import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  workflowUsage,
  type NewWorkflowUsageRow,
  type WorkflowUsageRow
} from "../schema/workflow-usage.js";

export interface UsageSum {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class WorkflowUsageRepo {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async append(row: NewWorkflowUsageRow): Promise<WorkflowUsageRow> {
    const [inserted] = await this.db.insert(workflowUsage).values(row).returning();
    if (!inserted) {
      throw new Error("WorkflowUsageRepo.append: insert returned no row");
    }
    return inserted;
  }

  async sumForRun(runId: string): Promise<UsageSum> {
    const [result] = await this.db
      .select({
        inputTokens: sql<number>`coalesce(sum(${workflowUsage.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${workflowUsage.outputTokens}), 0)::bigint`,
        costUsd: sql<string>`coalesce(sum(${workflowUsage.costUsd}), 0)`
      })
      .from(workflowUsage)
      .where(eq(workflowUsage.workflowRunId, runId));

    return {
      inputTokens: Number(result?.inputTokens ?? 0),
      outputTokens: Number(result?.outputTokens ?? 0),
      costUsd: Number(result?.costUsd ?? "0")
    };
  }
}
