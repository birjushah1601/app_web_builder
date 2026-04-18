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

describe("SpecEventRepo.listSince", () => {
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

  it("returns events with id > cursor in ascending id order", async () => {
    const projectId = uniqueProjectId();
    const a = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const b = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    const c = await repo.append(projectId, { eventType: "c", payload: {}, actor: null });
    const rows = await repo.listSince(projectId, a.id);
    expect(rows.map((r) => r.eventType)).toEqual(["b", "c"]);
    expect(rows[0]!.id).toBe(b.id);
  });

  it("returns an empty array when cursor >= latest event", async () => {
    const projectId = uniqueProjectId();
    const a = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const rows = await repo.listSince(projectId, a.id);
    expect(rows).toEqual([]);
  });

  it("does not leak other projects' events (RLS)", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await repo.append(projectA, { eventType: "a", payload: {}, actor: null });
    await repo.append(projectB, { eventType: "b", payload: {}, actor: null });
    const aRows = await repo.listSince(projectA, 0n);
    expect(aRows.map((r) => r.eventType)).toEqual(["a"]);
  });

  it("honours the optional limit parameter", async () => {
    const projectId = uniqueProjectId();
    for (let i = 0; i < 5; i++) {
      await repo.append(projectId, { eventType: `e${i}`, payload: {}, actor: null });
    }
    const rows = await repo.listSince(projectId, 0n, { limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
