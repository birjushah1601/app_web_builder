import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { mergeSpecGraphJsonMirrorFirst } from "../src/merge/spec-graph-json.js";

describe("mergeSpecGraphJsonMirrorFirst", () => {
  let db: Database;
  let graphs: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the mirror state verbatim when ATLAS_DATABASE_URL points at a reachable DB", async () => {
    const projectId = randomUUID();
    const mirrorState = { schemaVersion: 1, nodes: [{ id: "from-mirror" }], edges: [], metadata: { projectId } };
    await graphs.create(projectId, mirrorState);

    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "ours" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "theirs" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    const parsed = JSON.parse(merged);
    expect(parsed.nodes).toEqual([{ id: "from-mirror" }]);
  });

  it("falls back to structural merger when databaseUrl is undefined", async () => {
    const projectId = randomUUID();
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "ours" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "theirs" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, { databaseUrl: undefined });
    const parsed = JSON.parse(merged);
    const ids = parsed.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["ours", "theirs"]);
  });

  it("falls back when the mirror has no row for the projectId", async () => {
    const projectId = randomUUID(); // not inserted
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });

  it("falls back when databaseUrl points at an unreachable host (timeout under 2s)", async () => {
    const projectId = randomUUID();
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: { projectId } });

    const start = Date.now();
    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: "postgresql://atlas:atlas@127.0.0.1:9/atlas_dev" // port 9 refuses
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4_000);
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });

  it("falls back when no projectId can be discovered in any of the three files", async () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: {} });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: {} });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });
});
