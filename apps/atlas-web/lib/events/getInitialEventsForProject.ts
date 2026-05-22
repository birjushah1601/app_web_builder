/**
 * Bug D17 fix — server-fetch the latest spec_events for a project, mapped
 * into the RitualEvent shape that EventSourceProvider consumes, so the
 * canvas/timeline UI is hydrated on mount instead of blank-until-SSE.
 *
 * Without this, navigating to /projects/:id/canvas while a ritual already
 * produced events (the common case — rituals run ~9 min, users refresh)
 * shows an empty UI until new events arrive on the SSE stream. The broker's
 * in-memory ring buffer covers same-process recency only; events from
 * before a server restart only live in DB.
 *
 * Server-only (touches `pg`). Mirrors the failure-safe pattern used by
 * `getLatestRitualForProject` and `listProjectEvents`:
 *   - DATABASE_URL missing → returns [].
 *   - Postgres unreachable → caught + returns []. Page still renders;
 *     SSE will populate state as new events arrive.
 *
 * Id strategy: we synthesize ids of the form `${projectId}:db-${rowId}`
 * so they slot into EventSourceProvider's id-based dedupe set. The broker
 * uses `${projectId}:${counter}` (counter is in-process bigserial-like),
 * so `db-` prefix guarantees no collision with broker ids. When the
 * broker's ring-buffer replay on first SSE connect overlaps the live
 * tail it stays correctly deduped (broker ids match across replay
 * boundaries); when seed and SSE describe the SAME physical event with
 * DIFFERENT ids the UI will briefly show both — this is a known minor
 * cosmetic that we accept rather than re-architect the dual-write.
 */

import type { Pool } from "pg";
import type { RitualEvent, RitualEventType } from "./EventBroker";

let _pool: Pool | null = null;

async function getPool(): Promise<Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (_pool) return _pool;
  const { Pool: PgPool } = await import("pg");
  _pool = new PgPool({ connectionString: url });
  return _pool;
}

interface RawEventRow {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: Date;
}

/**
 * Fetch up to `limit` most-recent events for the project, returned in
 * ASC id order (oldest first) so consumers can iterate as a timeline.
 *
 * The pool can be injected for tests so we don't have to mock the
 * singleton state.
 */
export async function getInitialEventsForProject(
  projectId: string,
  limit: number = 200,
  pool?: Pool
): Promise<RitualEvent[]> {
  try {
    const p = pool ?? (await getPool());
    if (!p) return [];
    // spec_events has RLS keyed on app.project_id; wrap the SELECT in a
    // transaction that sets the GUC first — without it every read returns
    // 0 rows. Same pattern as getLatestRitualForProject.
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);
      // Pull DESC + LIMIT then reverse so we keep newest N but hand them
      // back in ASC order (timeline expectation). For typical rituals
      // (~50 events) limit=200 is plenty; the SSE stream picks up from
      // here as new events arrive.
      const result = await client.query<RawEventRow>(
        `SELECT id::text AS id, event_type, payload, created_at
         FROM spec_events
         WHERE project_id = $1
         ORDER BY id DESC
         LIMIT $2`,
        [projectId, limit]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => rowToRitualEvent(projectId, row)).reverse();
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => { /* swallow */ });
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    // DB unreachable, schema drift, etc. The page must still render
    // (failure-safe per task constraint); SSE will populate state as
    // new events arrive.
    console.warn(
      `[atlas-web] getInitialEventsForProject(${projectId}) failed; defaulting to []:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

function rowToRitualEvent(projectId: string, row: RawEventRow): RitualEvent {
  const payload: Record<string, unknown> =
    typeof row.payload === "string"
      ? safeJsonParse(row.payload)
      : (row.payload as Record<string, unknown>) ?? {};
  const ritualId = typeof payload.ritualId === "string" ? payload.ritualId : "";
  const payloadTs = typeof payload.ts === "number" ? payload.ts : undefined;
  const ts =
    payloadTs ??
    (row.created_at instanceof Date
      ? row.created_at.getTime()
      : new Date(String(row.created_at)).getTime());
  return {
    id: `${projectId}:db-${row.id}`,
    projectId,
    ritualId,
    type: row.event_type as RitualEventType,
    payload,
    ts
  };
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Test-only — drops the cached pool so subsequent calls re-read env. */
export function _resetGetInitialEventsForTests(): void {
  _pool = null;
}
