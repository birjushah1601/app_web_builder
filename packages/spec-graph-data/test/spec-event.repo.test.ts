import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecEventRepo } from "../src/repo/spec-event.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecEventRepo.append", () => {
  let db: Database;
  let repo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns an event with a positive id, timestamp, and echoed fields", async () => {
    const projectId = uniqueProjectId();
    const event = await repo.append(projectId, {
      eventType: "node.created",
      payload: { nodeId: "n1", kind: "Page" },
      actor: "architect"
    });
    expect(event.id).toBeGreaterThan(0n);
    expect(event.projectId).toBe(projectId);
    expect(event.eventType).toBe("node.created");
    expect(event.payload).toEqual({ nodeId: "n1", kind: "Page" });
    expect(event.actor).toBe("architect");
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it("accepts a null actor for system events", async () => {
    const projectId = uniqueProjectId();
    const event = await repo.append(projectId, {
      eventType: "graph.snapshot_applied",
      payload: { reason: "compaction" },
      actor: null
    });
    expect(event.actor).toBeNull();
  });

  it("assigns monotonically increasing ids per project", async () => {
    const projectId = uniqueProjectId();
    const first = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const second = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    expect(second.id).toBeGreaterThan(first.id);
  });
});
