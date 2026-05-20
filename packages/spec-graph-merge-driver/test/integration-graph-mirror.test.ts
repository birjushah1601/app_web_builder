import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { createTmpRepo } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

async function registerLocalDriver(repo: string, _databaseUrl: string): Promise<void> {
  mkdirSync(join(repo, ".atlas"), { recursive: true });
  writeFileSync(
    join(repo, ".gitattributes"),
    ".atlas/events.jsonl     merge=atlas-spec-graph\n" +
      ".atlas/spec.graph.json  merge=atlas-spec-graph\n"
  );
  await execa(
    "git",
    [
      "config",
      "merge.atlas-spec-graph.driver",
      `node "${DRIVER_BIN}" merge %O %A %B %P`
    ],
    { cwd: repo }
  );
  await execa("git", ["config", "merge.atlas-spec-graph.recursive", "binary"], { cwd: repo });
}

describe("integration: spec.graph.json merge with reachable mirror", () => {
  let db: Database;
  let graphs: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("discards both branch versions and regenerates from the mirror", async () => {
    const projectId = randomUUID();
    const repo = await createTmpRepo("atlas-int-graph-mirror-");
    await registerLocalDriver(repo, process.env.DATABASE_URL_TEST!);

    const graphPath = join(repo, ".atlas", "spec.graph.json");
    const basePayload = { schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } };
    writeFileSync(graphPath, JSON.stringify(basePayload));
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    await graphs.create(projectId, {
      schemaVersion: 1,
      nodes: [{ id: "authoritative" }],
      edges: [],
      metadata: { projectId }
    });

    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "branchA" }], edges: [], metadata: { projectId } })
    );
    await execa("git", ["commit", "-am", "branchA"], { cwd: repo });

    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "main" }], edges: [], metadata: { projectId } })
    );
    await execa("git", ["commit", "-am", "main"], { cwd: repo });

    const res = await execa("git", ["merge", "--no-edit", "branchA"], {
      cwd: repo,
      env: { ...process.env, ATLAS_DATABASE_URL: process.env.DATABASE_URL_TEST! },
      reject: false
    });
    expect(res.exitCode).toBe(0);

    const merged = JSON.parse(readFileSync(graphPath, "utf8"));
    expect(merged.nodes).toEqual([{ id: "authoritative" }]);
  });
});
