import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  appendEventLine,
  createProjectFixture,
  seedGraph,
  truncateAll,
  writeGraphFile,
  type ProjectFixture
} from "./helpers.js";
import {
  SpecEventRepo,
  SpecGraphRepo,
  createDatabase,
  type Database
} from "@atlas/spec-graph-data";
import {
  ingestNewEventLines,
  syncGraphFileToMirror,
  type FileToMirrorState
} from "../src/file-to-mirror.js";

describe("ingestNewEventLines", () => {
  let db: Database;
  let fx: ProjectFixture;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("appends each new JSONL line as a spec_event row", async () => {
    appendEventLine(fx.eventsPath, {
      eventType: "node.created",
      payload: { id: "n1" },
      actor: "architect"
    });
    appendEventLine(fx.eventsPath, {
      eventType: "edge.created",
      payload: { from: "n1", to: "n2" },
      actor: "architect"
    });

    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });

    expect(result.appended).toBe(2);
    expect(result.invalid).toBe(0);
    expect(state.eventsFileOffset).toBeGreaterThan(0);

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["node.created", "edge.created"]);
  });

  it("only reads new bytes after the stored offset (no duplicates on re-ingest)", async () => {
    appendEventLine(fx.eventsPath, { eventType: "a", payload: {}, actor: null });
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });
    appendEventLine(fx.eventsPath, { eventType: "b", payload: {}, actor: null });
    const result = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });

    expect(result.appended).toBe(1);
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["a", "b"]);
  });

  it("skips malformed JSON lines and counts them as invalid", async () => {
    appendEventLine(fx.eventsPath, { eventType: "valid", payload: {}, actor: null });
    // Append a raw broken line (not via helper)
    const { appendFileSync } = await import("node:fs");
    appendFileSync(fx.eventsPath, "this-is-not-json\n");
    appendEventLine(fx.eventsPath, { eventType: "also-valid", payload: {}, actor: null });

    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });

    expect(result.appended).toBe(2);
    expect(result.invalid).toBe(1);
  });

  it("rejects events missing required fields (eventType/payload)", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(fx.eventsPath, `${JSON.stringify({ actor: "x" })}\n`);
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });
    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
  });

  it("tolerates a trailing partial line (no newline) by leaving it for next read", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      fx.eventsPath,
      `${JSON.stringify({ eventType: "a", payload: {}, actor: null })}\n`
    );
    appendFileSync(fx.eventsPath, JSON.stringify({ eventType: "b", payload: {}, actor: null })); // no trailing \n
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const r1 = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });
    expect(r1.appended).toBe(1);
    appendFileSync(fx.eventsPath, "\n");
    const r2 = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });
    expect(r2.appended).toBe(1);
  });
});

describe("syncGraphFileToMirror", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("reads the file, appends a 'graph.file_edited' event, and updates the mirror graph", async () => {
    const newGraph = { nodes: [{ id: "n1" }], edges: [] };
    writeGraphFile(fx.graphPath, newGraph);

    const result = await syncGraphFileToMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      eventRepo
    });

    expect(result.updated).toBe(true);
    const mirror = await graphRepo.findByProjectId(fx.projectId);
    expect(mirror?.graphData).toEqual(newGraph);
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events.map((e) => e.eventType)).toEqual(["graph.file_edited"]);
  });

  it("is a no-op when the file content already equals mirror state", async () => {
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] }); // same as seed
    const result = await syncGraphFileToMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      eventRepo
    });
    expect(result.updated).toBe(false);
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events).toHaveLength(0);
  });

  it("stamps the new event id as current_event_seq on the mirror row", async () => {
    writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
    await syncGraphFileToMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      eventRepo
    });
    const mirror = await graphRepo.findByProjectId(fx.projectId);
    const latest = await eventRepo.getLatest(fx.projectId);
    expect(mirror?.currentEventSeq).toBe(latest?.id);
  });

  it("throws a reconciliation-needed error if the project has no mirror row", async () => {
    const ghost = createProjectFixture();
    try {
      writeGraphFile(ghost.graphPath, { nodes: [], edges: [] });
      await expect(
        syncGraphFileToMirror({
          projectId: ghost.projectId,
          graphPath: ghost.graphPath,
          graphRepo,
          eventRepo
        })
      ).rejects.toThrow(/reconciliation-needed/i);
    } finally {
      ghost.cleanup();
    }
  });
});
