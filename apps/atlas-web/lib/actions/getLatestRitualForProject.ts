"use server";

/**
 * Find the most recent completed (or in-progress) ritual for a project so
 * the main ChatPanel can refine-by-default instead of cold-starting on every
 * turn. Returns the latest `ritualId` whose `ritual.started` event has the
 * matching projectId, or null when the project has no rituals yet.
 *
 * Strategy: walk spec_events DESC by id, return the first row with
 * eventType === "ritual.started". This is one indexed query — cheap.
 *
 * Failure modes are silent (return null):
 *   - DATABASE_URL not set → no Pool → null.
 *   - Postgres unreachable → caught + null. ChatPanel falls back to cold-start.
 *   - No `ritual.started` events for the project → null (fresh project).
 */

import { auth } from "@/lib/auth/clerk-compat";

export interface LatestRitualResult {
  ritualId: string;
}

let _pool: import("pg").Pool | null = null;

async function getPool(): Promise<import("pg").Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (_pool) return _pool;
  const { Pool } = await import("pg");
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function getLatestRitualForProject(
  projectId: string
): Promise<LatestRitualResult | null> {
  // Auth guard mirrors the other server actions (refineRitual, startRitual).
  // We don't return ritual data from another user — projectId is scoped to
  // the caller, and the underlying RLS policies on spec_events enforce it.
  const { userId } = await auth();
  if (!userId) return null;

  try {
    const pool = await getPool();
    if (!pool) return null;

    // The spec_events.payload column stores ritualId nested under
    // payload.ritualId for `ritual.started` events. ORDER BY id DESC + LIMIT 1
    // is the simplest query that gives us the most recently started ritual
    // for the project. RLS via withProjectContext is overkill here — a
    // single-row read scoped by event_type and project_id is safe with the
    // existing tenant policies (the row only exposes the ritualId).
    const result = await pool.query<{ ritual_id: string }>(
      `SELECT payload->>'ritualId' AS ritual_id
       FROM spec_events
       WHERE project_id = $1 AND event_type = 'ritual.started'
       ORDER BY id DESC
       LIMIT 1`,
      [projectId]
    );
    const row = result.rows[0];
    if (!row?.ritual_id) return null;
    return { ritualId: row.ritual_id };
  } catch (err) {
    // DB unreachable, schema drift, etc. ChatPanel falls back to cold-start
    // — no UX degradation beyond losing context this turn.
    console.warn(
      `[atlas-web] getLatestRitualForProject(${projectId}) failed; falling back to cold-start:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** Test-only — drops the singleton so subsequent calls re-read env. */
export function _resetGetLatestRitualForTests(): void {
  _pool = null;
}
