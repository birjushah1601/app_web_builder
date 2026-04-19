import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withAdvisoryLock, projectLockKey } from "../src/compaction/advisory-lock.js";
import { createTestDb, truncateAll, uniqueProjectId } from "./helpers.js";
import type { Database } from "@atlas/spec-graph-data";

describe("withAdvisoryLock", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("runs the callback when the lock is free and returns its value", async () => {
    const key = projectLockKey(uniqueProjectId());
    const result = await withAdvisoryLock(db.pool, key, async () => "done");
    expect(result).toEqual({ acquired: true, value: "done" });
  });

  it("returns acquired=false without running the callback if the lock is held", async () => {
    const projectId = uniqueProjectId();
    const key = projectLockKey(projectId);

    const holder = await db.pool.connect();
    await holder.query("SELECT pg_advisory_lock($1)", [key]);

    try {
      let ran = false;
      const result = await withAdvisoryLock(db.pool, key, async () => {
        ran = true;
        return "nope";
      });
      expect(result).toEqual({ acquired: false });
      expect(ran).toBe(false);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1)", [key]);
      holder.release();
    }
  });

  it("releases the lock even if the callback throws", async () => {
    const key = projectLockKey(uniqueProjectId());
    await expect(
      withAdvisoryLock(db.pool, key, async () => {
        throw new Error("kaboom");
      })
    ).rejects.toThrow("kaboom");

    const second = await withAdvisoryLock(db.pool, key, async () => "ok");
    expect(second).toEqual({ acquired: true, value: "ok" });
  });

  it("projectLockKey is deterministic and fits in a bigint", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const a = projectLockKey(id);
    const b = projectLockKey(id);
    expect(a).toBe(b);
    expect(typeof a).toBe("number");
  });
});
