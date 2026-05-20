import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Each package that writes to the shared atlas_test database uses its own
// schema so `pnpm -r test` can run them in parallel without clobbering
// public between concurrent setups. See D2 in known-deferrals.md.
const SCHEMA = "test_spec_graph_data";

const BASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://atlas:atlas@localhost:5440/atlas_test";
const SCOPED_URL = withSearchPath(BASE_URL, SCHEMA);

// Rewrite so consumer test files inherit the per-package schema.
process.env.DATABASE_URL_TEST = SCOPED_URL;

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

  // Replay migrations with search_path scoped to the test schema.
  const scopedPool = new Pool({ connectionString: SCOPED_URL });
  const scopedClient = await scopedPool.connect();
  try {
    const migrationDir = join(__dirname, "..", "drizzle");
    const files = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
      const statements = sql
        .split(/--> statement-breakpoint/g)
        .map((s) => s.trim())
        .filter(Boolean);
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
  // Include `public` so extensions (pgcrypto, etc.) remain resolvable.
  const optionsValue = `-c search_path=${schema},public`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}options=${encodeURIComponent(optionsValue)}`;
}
