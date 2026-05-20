import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgBranchingAdapter } from "../src/adapter.js";
import { replayMigrationsToSchema } from "../src/migrate.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "spec-graph-data", "drizzle");
const projectId = "22222222-2222-4222-8222-222222222222";

describe("replayMigrationsToSchema", () => {
  let pool: pg.Pool;
  let adapter: PgBranchingAdapter;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST! });
    adapter = new PgBranchingAdapter(pool);
  });

  beforeEach(async () => {
    const r = await pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%'"
    );
    for (const row of r.rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("replays every .sql file in order against the branch schema", async () => {
    const { schemaName } = await adapter.ensureBranch(projectId, "test-replay");
    const result = await replayMigrationsToSchema({ pool, schemaName, migrationsDir });
    expect(result.applied).toBeGreaterThan(0);
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schemaName]
    );
    expect(tables.rows.map((r) => r.table_name)).toContain("spec_graphs");
  });
});
