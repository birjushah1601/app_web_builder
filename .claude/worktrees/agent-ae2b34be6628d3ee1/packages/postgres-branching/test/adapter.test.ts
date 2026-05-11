import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PgBranchingAdapter } from "../src/adapter.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("PgBranchingAdapter", () => {
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

  it("ensureBranch creates a schema; second call is idempotent", async () => {
    const first = await adapter.ensureBranch(projectId, "main");
    expect(first.created).toBe(true);
    expect(first.schemaName).toMatch(/^br_[0-9a-f]{16}$/);
    const second = await adapter.ensureBranch(projectId, "main");
    expect(second.created).toBe(false);
    expect(second.schemaName).toBe(first.schemaName);
  });

  it("listBranches returns all branch schemas for a project", async () => {
    await adapter.ensureBranch(projectId, "main");
    await adapter.ensureBranch(projectId, "preview-1");
    await adapter.ensureBranch(projectId, "preview-2");
    const branches = await adapter.listBranches(projectId);
    expect(branches.length).toBe(3);
  });

  it("dropBranch removes the schema; no-op when absent", async () => {
    const ensured = await adapter.ensureBranch(projectId, "tmp");
    const dropped = await adapter.dropBranch(projectId, "tmp");
    expect(dropped.dropped).toBe(true);
    expect(dropped.schemaName).toBe(ensured.schemaName);
    const noop = await adapter.dropBranch(projectId, "tmp");
    expect(noop.dropped).toBe(false);
  });
});
