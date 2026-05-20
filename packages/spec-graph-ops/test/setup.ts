import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA = "test_spec_graph_ops";

const BASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://atlas:atlas@localhost:5440/atlas_test";
const SCOPED_URL = withSearchPath(BASE_URL, SCHEMA);
process.env.DATABASE_URL_TEST = SCOPED_URL;

// Admin URL for the SECURITY DEFINER helper — needs superuser.
function adminUrl(): string {
  const base = new URL(BASE_URL);
  base.username = "postgres";
  base.password = "postgres";
  return base.toString();
}

export async function setup(): Promise<void> {
  const adminPool = new Pool({ connectionString: BASE_URL });
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminClient.query(`CREATE SCHEMA "${SCHEMA}"`);
    await adminClient.query(`GRANT ALL ON SCHEMA "${SCHEMA}" TO atlas`);
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  const scopedPool = new Pool({ connectionString: SCOPED_URL });
  const scopedClient = await scopedPool.connect();
  try {
    const migrationDir = join(__dirname, "..", "..", "spec-graph-data", "drizzle");
    const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
      const statements = sql.split(/--> statement-breakpoint/g).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await scopedClient.query(stmt);
      }
    }
  } finally {
    scopedClient.release();
    await scopedPool.end();
  }

  // Install the SECURITY DEFINER helper that lets the atlas role enumerate
  // every project id without being blocked by FORCE ROW LEVEL SECURITY.
  // Qualified FROM avoids any search_path ambiguity at call time — the
  // function lives in `public` (owned by postgres) but reads from the
  // per-package schema we just migrated into.
  const superPool = new Pool({ connectionString: adminUrl() });
  const superClient = await superPool.connect();
  try {
    await superClient.query(`
      CREATE OR REPLACE FUNCTION public.list_all_project_ids()
        RETURNS TABLE(project_id uuid)
        LANGUAGE sql
        SECURITY DEFINER
        SET row_security = off
      AS $$
        SELECT DISTINCT project_id FROM ${SCHEMA}.spec_graphs ORDER BY project_id
      $$
    `);
    await superClient.query("GRANT EXECUTE ON FUNCTION public.list_all_project_ids() TO atlas");
  } finally {
    superClient.release();
    await superPool.end();
  }
}

function withSearchPath(url: string, schema: string): string {
  // search_path includes public as a fallback so the SECURITY DEFINER helper
  // in public.list_all_project_ids() remains unqualified-callable from
  // @atlas/spec-graph-ops code at runtime.
  const optionsValue = `-c search_path=${schema},public`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}options=${encodeURIComponent(optionsValue)}`;
}
