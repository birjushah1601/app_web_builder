import { readFileSync, existsSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { writeGraphFromMirror } from "../src/mirror-to-file.js";
import { createProjectFixture, seedGraph, truncateAll, type ProjectFixture } from "./helpers.js";
import { WriteTokenRegistry } from "../src/write-token.js";

describe("writeGraphFromMirror", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("writes the mirror's graph_data to spec.graph.json", async () => {
    const data = { nodes: [{ id: "n1" }], edges: [] };
    await seedGraph(db, fx.projectId, data);
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      tokens
    });
    const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as unknown;
    expect(onDisk).toEqual(data);
  });

  it("registers a write token for the hash of what it wrote", async () => {
    const data = { nodes: [{ id: "n2" }], edges: [] };
    await seedGraph(db, fx.projectId, data);
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      tokens
    });

    const written = readFileSync(fx.graphPath, "utf8");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(written).digest("hex");
    expect(tokens.wasWrittenByUs(fx.graphPath, hash)).toBe(true);
  });

  it("uses write-temp-then-rename so a crash mid-write leaves the original intact", async () => {
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      tokens
    });
    // The temp file should not linger after a successful rename
    expect(existsSync(`${fx.graphPath}.tmp`)).toBe(false);
  });

  it("throws when the mirror has no row for the project", async () => {
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await expect(
      writeGraphFromMirror({
        projectId: fx.projectId,
        graphPath: fx.graphPath,
        graphRepo,
        tokens
      })
    ).rejects.toThrow(/no mirror row/i);
  });
});
