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

describe("SpecEventRepo.getLatest", () => {
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

  it("returns the highest-id event for the project", async () => {
    const projectId = uniqueProjectId();
    await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const b = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    const latest = await repo.getLatest(projectId);
    expect(latest?.id).toBe(b.id);
  });

  it("returns null when the project has no events", async () => {
    expect(await repo.getLatest(uniqueProjectId())).toBeNull();
  });
});

describe("SpecEventRepo.listByRitual (plan H)", () => {
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

  it("returns only events whose payload.ritualId matches, ordered by id ASC", async () => {
    const projectId = uniqueProjectId();
    await repo.append(projectId, { eventType: "ritual.started",  payload: { ritualId: "r-A", ts: 1 }, actor: null });
    await repo.append(projectId, { eventType: "role.started",    payload: { ritualId: "r-B", ts: 2 }, actor: null });
    await repo.append(projectId, { eventType: "role.completed",  payload: { ritualId: "r-A", ts: 3 }, actor: null });
    const rows = await repo.listByRitual(projectId, "r-A");
    expect(rows.length).toBe(2);
    expect(rows[0]!.eventType).toBe("ritual.started");
    expect(rows[1]!.eventType).toBe("role.completed");
  });

  it("returns [] when no events match the ritualId", async () => {
    const projectId = uniqueProjectId();
    const rows = await repo.listByRitual(projectId, "r-DOES-NOT-EXIST");
    expect(rows).toEqual([]);
  });

  it("respects the limit option (default 10000)", async () => {
    const projectId = uniqueProjectId();
    for (let i = 0; i < 5; i++) {
      await repo.append(projectId, { eventType: "role.started", payload: { ritualId: "r-LIM", ts: i }, actor: null });
    }
    const rows = await repo.listByRitual(projectId, "r-LIM", { limit: 3 });
    expect(rows.length).toBe(3);
  });
});
