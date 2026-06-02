// Plan F.4 Task 3 — unit tests for the BranchingPort + MigratePort adapters
// that replace the inline stubs in factory.ts:buildDeployRunner. The adapters
// wrap @atlas/postgres-branching's PgBranchingAdapter + replayMigrationsToSchema
// behind the structural ports the deploy-orchestrator expects.

import { describe, it, expect, vi } from "vitest";
import { createDeployBranching, createDeployMigrate } from "@/lib/engine/branching";

describe("createDeployBranching", () => {
  it("delegates ensureBranch to the underlying adapter", async () => {
    const ensureBranch = vi.fn(async () => ({ schemaName: "br_deadbeef00000000", created: true }));
    const port = createDeployBranching({
      ensureBranch,
      dropBranch: vi.fn(),
      listBranches: vi.fn(async () => [])
    });
    const r = await port.ensureBranch("proj-1", "wf-run-1");
    expect(ensureBranch).toHaveBeenCalledWith("proj-1", "wf-run-1");
    expect(r.created).toBe(true);
    expect(r.schemaName).toMatch(/^br_/);
  });

  it("delegates dropBranch", async () => {
    const dropBranch = vi.fn(async () => ({ schemaName: "br_x", dropped: true }));
    const port = createDeployBranching({
      ensureBranch: vi.fn(),
      dropBranch,
      listBranches: vi.fn(async () => [])
    });
    await port.dropBranch("p", "b");
    expect(dropBranch).toHaveBeenCalledWith("p", "b");
  });

  it("delegates listBranches", async () => {
    const listBranches = vi.fn(async () => ["br_one", "br_two"]);
    const port = createDeployBranching({
      ensureBranch: vi.fn(),
      dropBranch: vi.fn(),
      listBranches
    });
    const r = await port.listBranches("p");
    expect(listBranches).toHaveBeenCalledWith("p");
    expect(r).toEqual(["br_one", "br_two"]);
  });
});

describe("createDeployMigrate", () => {
  it("calls the injected replay with pool + schemaName + migrationsDir", async () => {
    const replay = vi.fn(async () => ({
      schemaName: "br_x",
      applied: 5,
      filenames: ["0001_one.sql", "0002_two.sql"]
    }));
    const pool = { __pool: true } as never;
    const migrate = createDeployMigrate({ pool, migrationsDir: "/fake/dir", replay });
    const r = await migrate({ schemaName: "br_x" });
    expect(replay).toHaveBeenCalledWith({
      pool,
      schemaName: "br_x",
      migrationsDir: "/fake/dir"
    });
    expect(r.applied).toBe(5);
    expect(r.filenames).toHaveLength(2);
  });

  it("returns the replay result verbatim", async () => {
    const replay = vi.fn(async () => ({
      schemaName: "br_one",
      applied: 0,
      filenames: [] as string[]
    }));
    const migrate = createDeployMigrate({ pool: {} as never, migrationsDir: "/x", replay });
    const r = await migrate({ schemaName: "br_one" });
    expect(r).toEqual({ schemaName: "br_one", applied: 0, filenames: [] });
  });
});
