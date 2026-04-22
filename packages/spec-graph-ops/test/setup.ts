import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://atlas:atlas@localhost:5440/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;

// Admin URL for operations that require a superuser (e.g. SECURITY DEFINER functions).
// Defaults to the postgres superuser on the same host/port derived from TEST_URL.
function adminUrl(): string {
  const base = new URL(TEST_URL);
  base.username = "postgres";
  base.password = "postgres";
  return base.toString();
}

export async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    const migrationDir = join(__dirname, "..", "..", "spec-graph-data", "drizzle");
    const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
      const statements = sql.split(/--> statement-breakpoint/g).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  // Install the SECURITY DEFINER helper that lets the atlas role enumerate all
  // project IDs without being blocked by FORCE ROW LEVEL SECURITY. This must
  // run as a superuser because SECURITY DEFINER + SET row_security = off is
  // required to bypass FORCE RLS on behalf of the calling atlas role.
  const adminPool = new Pool({ connectionString: adminUrl() });
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query(`
      CREATE OR REPLACE FUNCTION list_all_project_ids()
        RETURNS TABLE(project_id uuid)
        LANGUAGE sql
        SECURITY DEFINER
        SET row_security = off
      AS $$
        SELECT DISTINCT project_id FROM spec_graphs ORDER BY project_id
      $$
    `);
    await adminClient.query("GRANT EXECUTE ON FUNCTION list_all_project_ids() TO atlas");
  } finally {
    adminClient.release();
    await adminPool.end();
  }
}
