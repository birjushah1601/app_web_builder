// packages/spec-graph-data/test/eval-verdict.repo.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/client.js";
import { EvalVerdictRepo } from "../src/repo/eval-verdict.repo.js";
import type { NewEvalVerdictRow } from "../src/schema/eval-verdicts.js";
import { truncateAllTables, seedProject } from "./helpers.js";

let db: Database;
let repo: EvalVerdictRepo;

db = createDatabase(process.env.DATABASE_URL_TEST!);
repo = new EvalVerdictRepo(db.pool);

afterAll(async () => { await db.pool.end(); });
beforeEach(async () => { await truncateAllTables(db); });

function baseRow(overrides: Partial<NewEvalVerdictRow> = {}): NewEvalVerdictRow {
  return {
    ritualId: "r-1",
    roleId: "architect",
    projectId: "00000000-0000-0000-0000-00000000aaaa",
    userId: "u1",
    attempt: 1,
    layer: "structural",
    passed: true,
    rubricVersion: "architect@1.0.0",
    ...overrides
  };
}

describe("EvalVerdictRepo", () => {
  it("insert + findByRitual round-trip", async () => {
    await seedProject(db, "00000000-0000-0000-0000-00000000aaaa");
    const inserted = await repo.insert(baseRow());
    expect(inserted.id).toBeTruthy();
    const rows = await repo.findByRitual("r-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roleId).toBe("architect");
  });

  it("findFailuresForRole returns only failed verdicts", async () => {
    await seedProject(db, "00000000-0000-0000-0000-00000000aaaa");
    await repo.insert(baseRow({ passed: true }));
    await repo.insert(baseRow({ ritualId: "r-2", passed: false, failures: [{ check: "x", reason: "y" }] }));
    const failures = await repo.findFailuresForRole("architect", 10);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.ritualId).toBe("r-2");
  });

  it("findUniqueByInputHash dedupes by (role, hash, userTurn)", async () => {
    await seedProject(db, "00000000-0000-0000-0000-00000000aaaa");
    await repo.insert(baseRow({ priorArtifactHash: "h1", userTurn: "Build X" }));
    await repo.insert(baseRow({ priorArtifactHash: "h1", userTurn: "Build X", ritualId: "r-2" }));
    await repo.insert(baseRow({ priorArtifactHash: "h2", userTurn: "Build X", ritualId: "r-3" }));
    const rows = await repo.findUniqueByInputHash("architect", "h1", "Build X");
    expect(rows).toHaveLength(2); // two rows with same hash+userTurn
  });
});
