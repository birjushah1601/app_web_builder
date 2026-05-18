/**
 * Plan H integration test — real Postgres roundtrip.
 *
 * Append a ritual.started + architect.pass2.completed + ritual.completed
 * sequence into spec_events, then ask SpecEventsHydrator to fold them
 * back into a RitualSnapshot. Proves the read path end-to-end against
 * the same Postgres the production engine writes to.
 *
 * Skipped cleanly when DATABASE_URL_TEST is unset — matches the existing
 * spec-graph-data test fixture so CI without a database doesn't fail.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { SpecEventRepo } from "@atlas/spec-graph-data";
import { SpecEventsHydrator } from "@/lib/engine/spec-events-hydrator";

const DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("ritual hydration roundtrip — Plan H Task 11", () => {
  let pool: Pool;
  let repo: SpecEventRepo;
  const projectId = `p-h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ritualId  = `r-h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repo = new SpecEventRepo(pool);
  });

  afterAll(async () => { await pool.end(); });

  it("appends ritual.started + architect.pass2.completed + ritual.completed and hydrates back", async () => {
    await repo.append(projectId, {
      eventType: "ritual.started",
      payload: { ritualId, ts: 1, projectId, userId: "u-h" },
      actor: null
    });
    await repo.append(projectId, {
      eventType: "architect.pass2.completed",
      payload: { ritualId, ts: 2, artifact: { kind: "plan", title: "hydration-test" } },
      actor: null
    });
    await repo.append(projectId, {
      eventType: "ritual.completed",
      payload: { ritualId, ts: 3 },
      actor: null
    });

    const hydrator = new SpecEventsHydrator(repo, projectId);
    const snap = await hydrator.hydrate(ritualId);

    expect(snap).not.toBeNull();
    expect(snap!.state).toBe("done");
    expect(snap!.projectId).toBe(projectId);
    expect(snap!.userId).toBe("u-h");
    expect((snap!.artifact as { kind: string }).kind).toBe("plan");
    expect(snap!.roleEvents.length).toBe(1);
    expect(snap!.roleEvents[0]!.eventType).toBe("architect.pass2.completed");
  });

  it("returns null for a ritualId that has no events in the project", async () => {
    const hydrator = new SpecEventsHydrator(repo, projectId);
    expect(await hydrator.hydrate("r-NOT-WRITTEN")).toBeNull();
  });
});
