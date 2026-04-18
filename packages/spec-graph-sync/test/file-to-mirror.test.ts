import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  appendEventLine,
  createProjectFixture,
  seedGraph,
  truncateAll,
  type ProjectFixture
} from "./helpers.js";
import { SpecEventRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { ingestNewEventLines, type FileToMirrorState } from "../src/file-to-mirror.js";

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
