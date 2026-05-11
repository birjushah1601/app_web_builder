import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SpecEventRepo,
  SpecGraphRepo,
  SpecSnapshotRepo,
  createDatabase,
  type Database
} from "../src/index.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("integration: full spec-graph lifecycle across two projects with RLS", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let snapshots: SpecSnapshotRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
    snapshots = new SpecSnapshotRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates → mutates → snapshots two isolated projects", async () => {
    const pA = uniqueProjectId();
    const pB = uniqueProjectId();

    // Create graphs for both projects
    await graphs.create(pA, { name: "alpha" });
    await graphs.create(pB, { name: "beta" });

    // Append events to each
    const eA1 = await events.append(pA, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    const eA2 = await events.append(pA, { eventType: "edge.created", payload: { from: "n1", to: "n2" }, actor: "architect" });
    const eB1 = await events.append(pB, { eventType: "node.created", payload: { id: "m1" }, actor: "developer" });

    // Update graph payloads + current_event_seq
    await graphs.updateGraphData(pA, { nodes: ["n1", "n2"], edges: [["n1", "n2"]] }, eA2.id);
    await graphs.updateGraphData(pB, { nodes: ["m1"] }, eB1.id);

    // Take snapshots
    await snapshots.create(pA, { upToEventId: eA2.id, graphData: { nodes: ["n1", "n2"] }, reason: "manual" });
    await snapshots.create(pB, { upToEventId: eB1.id, graphData: { nodes: ["m1"] }, reason: "manual" });

    // Verify RLS: A cannot see B's events, snapshots, or graph
    const aEvents = await events.listSince(pA, 0n);
    expect(aEvents.map((e) => e.eventType)).toEqual(["node.created", "edge.created"]);
    expect(aEvents.every((e) => e.projectId === pA)).toBe(true);

    const aSnap = await snapshots.findLatest(pA);
    expect(aSnap?.projectId).toBe(pA);
    expect(aSnap?.graphData).toEqual({ nodes: ["n1", "n2"] });

    const aGraph = await graphs.findByProjectId(pA);
    expect(aGraph?.currentEventSeq).toBe(eA2.id);

    // Confirm B's events are untouched and also isolated
    const bEvents = await events.listSince(pB, 0n);
    expect(bEvents.map((e) => e.eventType)).toEqual(["node.created"]);
    expect(bEvents.every((e) => e.projectId === pB)).toBe(true);
  });
});
