import type { Pool, PoolClient } from "pg";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function withProjectContext<T>(
  pool: Pool,
  projectId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!UUID_RE.test(projectId)) {
    throw new Error(`withProjectContext: projectId must be a UUID, got "${projectId}"`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(name, value, is_local) with is_local=true scopes to the transaction
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* swallow — original error is the important one */
    });
    throw error;
  } finally {
    client.release();
  }
}
