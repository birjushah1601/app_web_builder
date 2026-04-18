import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { withProjectContext } from "../src/tenant.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("withProjectContext", () => {
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

  it("sets app.project_id as a session-local setting for the duration of the callback", async () => {
    const projectId = uniqueProjectId();
    const inside = await withProjectContext(db.pool, projectId, async (client) => {
      const { rows } = await client.query<{ value: string }>("SELECT current_setting('app.project_id', true) AS value");
      return rows[0]?.value;
    });
    expect(inside).toBe(projectId);
  });

  it("does not leak the setting outside the transaction", async () => {
    const projectId = uniqueProjectId();
    await withProjectContext(db.pool, projectId, async () => {
      /* inside; setting active */
    });
    const { rows } = await db.pool.query<{ value: string | null }>("SELECT current_setting('app.project_id', true) AS value");
    // current_setting with missing_ok=true returns '' (or null) when unset or after a SET LOCAL txn commits
    expect(rows[0]?.value === null || rows[0]?.value === "").toBe(true);
  });

  it("propagates errors from the callback and does not swallow them", async () => {
    const projectId = uniqueProjectId();
    await expect(
      withProjectContext(db.pool, projectId, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
