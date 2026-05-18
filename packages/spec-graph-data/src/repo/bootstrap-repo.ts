import type { Pool } from "pg";

export interface BootstrapRecord {
  ts: string;
  ritualId: string;
}

export class BootstrapRepo {
  constructor(private readonly pool: Pool) {}

  async hasPassed(projectId: string): Promise<boolean> {
    const r = await this.pool.query("SELECT 1 FROM bootstrap_checkpoints WHERE project_id = $1", [projectId]);
    return r.rowCount! > 0;
  }

  async markPassed(projectId: string, record: BootstrapRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO bootstrap_checkpoints (project_id, ts, ritual_id) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO NOTHING",
      [projectId, record.ts, record.ritualId]
    );
  }

  async getRecord(projectId: string): Promise<BootstrapRecord | null> {
    const r = await this.pool.query<{ ts: string; ritual_id: string }>(
      "SELECT ts, ritual_id FROM bootstrap_checkpoints WHERE project_id = $1",
      [projectId]
    );
    const row = r.rows[0];
    if (!row) return null;
    return { ts: row.ts, ritualId: row.ritual_id };
  }
}
