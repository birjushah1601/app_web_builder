import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { specGraphs } from "../src/schema/index.js";
import { withProjectContext } from "../src/tenant.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("Postgres RLS enforcement", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("blocks reads when no app.project_id is set", async () => {
    const projectA = uniqueProjectId();
    // Insert as projectA via context
    await withProjectContext(db.pool, projectA, async (client) => {
      await client.query(
        `INSERT INTO spec_graphs (project_id, graph_data) VALUES ($1, '{}'::jsonb)`,
        [projectA]
      );
    });
    // Read outside any project context → should return 0 rows
    const { rowCount } = await db.pool.query("SELECT * FROM spec_graphs");
    expect(rowCount).toBe(0);
  });

  it("isolates projects: project A cannot see project B's rows", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await withProjectContext(db.pool, projectA, async (client) => {
      await client.query(
        `INSERT INTO spec_graphs (project_id, graph_data) VALUES ($1, '{}'::jsonb)`,
        [projectA]
      );
    });
    const seenByB = await withProjectContext(db.pool, projectB, async (client) => {
      const { rows } = await client.query("SELECT id FROM spec_graphs");
      return rows;
    });
    expect(seenByB).toEqual([]);
  });
});
