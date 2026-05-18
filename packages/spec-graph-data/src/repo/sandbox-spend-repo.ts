import type { Pool } from "pg";

export interface SpendRecord {
  projectId: string;
  sandboxId: string;
  usdAmount: number;
  occurredAt?: Date;
}

export class SandboxSpendRepo {
  constructor(private readonly pool: Pool) {}

  async record(input: SpendRecord): Promise<void> {
    const { projectId, sandboxId, usdAmount, occurredAt } = input;
    if (occurredAt) {
      await this.pool.query(
        "INSERT INTO sandbox_spend_log (project_id, sandbox_id, usd_amount, occurred_at) VALUES ($1, $2, $3, $4)",
        [projectId, sandboxId, usdAmount, occurredAt]
      );
    } else {
      await this.pool.query(
        "INSERT INTO sandbox_spend_log (project_id, sandbox_id, usd_amount) VALUES ($1, $2, $3)",
        [projectId, sandboxId, usdAmount]
      );
    }
  }

  /** Sum of usd_amount for this project since the first day of the current UTC month. */
  async getAccumulatedSpend(projectId: string): Promise<number> {
    const r = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(usd_amount), 0)::text AS total
         FROM sandbox_spend_log
        WHERE project_id = $1
          AND occurred_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [projectId]
    );
    return parseFloat(r.rows[0]?.total ?? "0");
  }

  /**
   * 30-day rolling average monthly spend — total of the last 30 days.
   * Returns 0 when no spend rows exist for the project.
   */
  async getRollingAverageSpend(projectId: string): Promise<number> {
    const r = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(usd_amount), 0)::text AS total
         FROM sandbox_spend_log
        WHERE project_id = $1
          AND occurred_at >= now() - interval '30 days'`,
      [projectId]
    );
    return parseFloat(r.rows[0]?.total ?? "0");
  }
}
