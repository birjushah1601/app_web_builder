import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";

describe("createDatabase", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("connects to Postgres and runs a trivial query", async () => {
    const result = await db.pool.query("SELECT 1 AS one");
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});
