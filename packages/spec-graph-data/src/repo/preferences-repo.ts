import type { Pool } from "pg";

export type PersonaOverride = "ama" | "diego" | "priya";

export class PreferencesRepo {
  constructor(private readonly pool: Pool) {}

  async getOverride(userId: string, projectId: string): Promise<PersonaOverride | null> {
    const r = await this.pool.query<{ persona: PersonaOverride }>(
      "SELECT persona FROM user_project_preferences WHERE user_id = $1 AND project_id = $2",
      [userId, projectId]
    );
    return r.rows[0]?.persona ?? null;
  }

  async upsertOverride(userId: string, projectId: string, persona: PersonaOverride): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_project_preferences (user_id, project_id, persona)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, project_id) DO UPDATE SET persona = EXCLUDED.persona, updated_at = now()`,
      [userId, projectId, persona]
    );
  }
}
