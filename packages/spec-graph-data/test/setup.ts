import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_URL = process.env.DATABASE_URL_TEST ?? "postgresql://atlas:atlas@localhost:5440/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;

export async function setup() {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    // Drop and recreate the public schema for a clean slate
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    // Apply all migrations in lexical order
    const migrationDir = join(__dirname, "..", "drizzle");
    const files = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
      // drizzle writes statement-breakpoint markers; split on them
      const statements = sql.split(/--> statement-breakpoint/g).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
