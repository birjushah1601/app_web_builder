import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { SyncDaemon } from "../src/daemon.js";
import { appendEventLine, createProjectFixture, seedGraph, truncateAll, waitFor, writeGraphFile, type ProjectFixture } from "./helpers.js";

describe("SyncDaemon — integration", () => {
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

  it("file -> mirror: appending to events.jsonl shows up in the mirror", async () => {
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start();
    try {
      appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
      await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length > 0, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toContain("node.created");
  });

  it("file -> mirror: editing spec.graph.json updates mirror + emits graph.file_edited", async () => {
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start();
    try {
      writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
      await waitFor(async () => {
        const g = await graphRepo.findByProjectId(fx.projectId);
        const data = g?.graphData as { nodes?: Array<{ id: string }>; edges?: unknown[] } | undefined;
        // Check structural equality — JSONB reorders keys so we can't use JSON.stringify directly
        return (
          Array.isArray(data?.nodes) &&
          data.nodes.length === 1 &&
          data.nodes[0]?.id === "n1" &&
          Array.isArray(data?.edges) &&
          data.edges.length === 0
        );
      }, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events.some((e) => e.eventType === "graph.file_edited")).toBe(true);
  });

  it("mirror -> file: on startup, regenerates spec.graph.json from mirror state", async () => {
    await graphRepo.updateGraphData(fx.projectId, { nodes: [{ id: "seed" }], edges: [] }, 0n);
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] }); // stale disk
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start({ regenerateOnStartup: true });
    try {
      await waitFor(() => {
        const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as { nodes: Array<{ id: string }> };
        return onDisk.nodes?.[0]?.id === "seed";
      }, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
  });

  it("round-trip: stop -> restart -> no event loss and no duplication", async () => {
    const d1 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d1.start();
    appendEventLine(fx.eventsPath, { eventType: "a", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 1, { timeoutMs: 5_000 });
    await d1.stop();

    const d2 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d2.start();
    appendEventLine(fx.eventsPath, { eventType: "b", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 2, { timeoutMs: 5_000 });
    await d2.stop();

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["a", "b"]);
  });
});

describe("SyncDaemon — full round-trip", () => {
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

  it("events -> mirror -> graph.json rewrite -> restart preserves state", async () => {
    const d1 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d1.start();

    // Step 1: append an event via the file
    appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 1, { timeoutMs: 5_000 });

    // Step 2: update the graph file
    writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
    await waitFor(async () => {
      const g = await graphRepo.findByProjectId(fx.projectId);
      return (g?.graphData as { nodes?: unknown[] })?.nodes?.length === 1;
    }, { timeoutMs: 5_000 });

    await d1.stop();

    // Step 3: tamper with the graph file while the daemon is down
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] });

    // Step 4: restart with regenerateOnStartup — disk should match mirror again
    const d2 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d2.start({ regenerateOnStartup: true });
    try {
      await waitFor(() => {
        const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as { nodes?: Array<{ id: string }> };
        return onDisk.nodes?.[0]?.id === "n1";
      }, { timeoutMs: 5_000 });
    } finally {
      await d2.stop();
    }

    // Step 5: no duplicate events in the mirror
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.filter((r) => r.eventType === "node.created")).toHaveLength(1);
  });
});
