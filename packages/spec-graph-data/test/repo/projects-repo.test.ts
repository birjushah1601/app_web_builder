import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../../src/client.js";
import { ProjectsRepo } from "../../src/repo/projects-repo.js";
import { truncateAllTables, uniqueProjectId } from "../helpers.js";

describe("ProjectsRepo", () => {
  let db: Database;
  let repo: ProjectsRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new ProjectsRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("create persists a project + spec_graph and returns the record", async () => {
    const record = await repo.create({ userId: "user_a", name: "My App" });
    expect(record.userId).toBe("user_a");
    expect(record.name).toBe("My App");
    expect(record.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.createdAt).toBeInstanceOf(Date);

    // Round-trips through findById.
    const loaded = await repo.findById(record.projectId);
    expect(loaded).toEqual(record);
  });

  it("create accepts a deterministic projectId for tests", async () => {
    const id = uniqueProjectId();
    const record = await repo.create({ userId: "user_a", name: "Pinned", projectId: id });
    expect(record.projectId).toBe(id);
  });

  it("create trims whitespace from name", async () => {
    const record = await repo.create({ userId: "user_a", name: "  spaced  " });
    expect(record.name).toBe("spaced");
  });

  it("create rejects empty name", async () => {
    await expect(repo.create({ userId: "user_a", name: "" })).rejects.toThrow(/name/i);
    await expect(repo.create({ userId: "user_a", name: "   " })).rejects.toThrow(/name/i);
  });

  it("create rejects empty userId", async () => {
    await expect(repo.create({ userId: "", name: "x" })).rejects.toThrow(/user/i);
  });

  it("listForUser returns the user's projects newest-first, scoped per user", async () => {
    const a1 = await repo.create({ userId: "user_a", name: "A1" });
    // Force a measurable created_at gap so the ORDER BY is deterministic.
    await new Promise((r) => setTimeout(r, 10));
    const a2 = await repo.create({ userId: "user_a", name: "A2" });
    await repo.create({ userId: "user_b", name: "B1" });

    const aProjects = await repo.listForUser("user_a");
    expect(aProjects.map((p) => p.projectId)).toEqual([a2.projectId, a1.projectId]);
    expect(aProjects.every((p) => p.userId === "user_a")).toBe(true);

    const bProjects = await repo.listForUser("user_b");
    expect(bProjects.map((p) => p.name)).toEqual(["B1"]);
  });

  it("listForUser returns [] for unknown users", async () => {
    expect(await repo.listForUser("nobody")).toEqual([]);
    expect(await repo.listForUser("")).toEqual([]);
  });

  it("findById returns null for unknown projects", async () => {
    expect(await repo.findById(uniqueProjectId())).toBeNull();
  });
});
