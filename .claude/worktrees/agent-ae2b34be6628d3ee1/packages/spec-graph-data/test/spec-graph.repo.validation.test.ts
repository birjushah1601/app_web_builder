import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@atlas/spec-graph-schema";
import { type Database, createDatabase } from "../src/client.js";
import { SpecGraphRepo, GraphValidationError } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

const minimalValid = {
  schemaVersion: "1.0.0",
  projectId: "00000000-0000-0000-0000-000000000000", // overridden per test
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: {
    tier: "atlas-run",
    provider: "neon",
    region: "us-east-1",
    connectionStringRef: "env:DATABASE_URL"
  },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {
    "compliance:baseline": {
      kind: "compliance",
      id: "compliance:baseline",
      name: "baseline",
      scope: "global",
      attestation: "self-attested",
      effectiveDate: "2026-04-19"
    }
  },
  edges: []
};

describe("SpecGraphRepo with opt-in validator", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("create() with validator accepts a valid graph", async () => {
    const projectId = uniqueProjectId();
    const repo = new SpecGraphRepo(db.pool, { validator: validate });
    const graphData = { ...minimalValid, projectId };
    await expect(repo.create(projectId, graphData)).resolves.toBeDefined();
  });

  it("create() with validator rejects an invalid graph", async () => {
    const projectId = uniqueProjectId();
    const repo = new SpecGraphRepo(db.pool, { validator: validate });
    const graphData = { ...minimalValid, projectId, nodes: {} }; // missing baseline ComplianceClass
    await expect(repo.create(projectId, graphData)).rejects.toBeInstanceOf(GraphValidationError);
  });

  it("create() without validator preserves the legacy schema-agnostic behavior", async () => {
    const projectId = uniqueProjectId();
    const repo = new SpecGraphRepo(db.pool); // no validator
    await expect(repo.create(projectId, { marker: "raw-test-payload" })).resolves.toBeDefined();
  });
});
