import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA = "test_spec_graph_merge_driver";

const BASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://atlas:atlas@localhost:5440/atlas_test";
const SCOPED_URL = withSearchPath(BASE_URL, SCHEMA);
process.env.DATABASE_URL_TEST = SCOPED_URL;
// The driver reads ATLAS_DATABASE_URL at runtime; tests opt into it explicitly.

export async function setup(): Promise<void> {
  const adminPool = new Pool({ connectionString: BASE_URL });
  const client = await adminPool.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.query(`CREATE SCHEMA "${SCHEMA}"`);
    await client.query(`GRANT ALL ON SCHEMA "${SCHEMA}" TO atlas`);
  } finally {
    client.release();
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
}

function withSearchPath(url: string, schema: string): string {
  const optionsValue = `-c search_path=${schema},public`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}options=${encodeURIComponent(optionsValue)}`;
}
