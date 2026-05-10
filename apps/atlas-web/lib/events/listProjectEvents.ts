/**
 * Plan #15 — Read the most recent N spec_events for a project, ordered
 * newest-first. Used by the events viewer page to render a sortable
 * audit trail without spinning up a real broker subscription.
 *
 * Server-only by virtue of touching `pg`. The page that calls it is a
 * Server Component, and the `pg` import in `getPool` would fail to
 * bundle in a client component (Next.js externalises pg in the server
 * runtime; importing it from the client throws at build time).
 *
 * Failure modes mirror getLatestRitualForProject:
 *   - DATABASE_URL missing → returns [].
 *   - Postgres unreachable → caught + returns []. Page renders "No events".
 */

import type { Pool } from "pg";

export interface ProjectEventRow {
  /** Database PK — surfaced as `seq` in the table column header to match
   *  the spec naming (seq is what other parts of the codebase call it). */
  seq: string;
  /** ISO-8601 timestamp string from spec_events.created_at. */
  ts: string;
  eventType: string;
  /** Best-effort role identifier pulled out of payload.roleId / payload.role.
   *  Empty string when neither field is present. */
  role: string;
  /** Full JSON payload as parsed object. The renderer pretty-prints this
   *  on row expand and slices the first 80 chars for the summary column. */
  payload: Record<string, unknown>;
}

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

/** Fetch up to `limit` events for the project, ordered by id DESC. The
 *  pool is allowed to be injected for tests so we don't have to mock
 *  the singleton state. */
export async function listProjectEvents(
  projectId: string,
  limit: number = 200,
  pool?: Pool
): Promise<ProjectEventRow[]> {
  try {
    const p = pool ?? (await getPool());
    if (!p) return [];
    // ORDER BY id DESC matches the spec's "ordered by seq desc" — id is a
    // bigserial so it gives the same ordering as a logical sequence
    // counter without an extra column. Limit is parameterised so tests
    // can shrink it; the page passes 200.
    const result = await p.query<RawEventRow>(
      `SELECT id::text AS id, event_type, payload, created_at
       FROM spec_events
       WHERE project_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [projectId, limit]
    );
    return result.rows.map(rowToEvent);
  } catch (err) {
    console.warn(
      `[atlas-web] listProjectEvents(${projectId}) failed; rendering empty list:`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

function rowToEvent(row: RawEventRow): ProjectEventRow {
  // pg returns jsonb columns as already-parsed objects, but defensive
  // re-parse in case a node-postgres adapter has different behavior.
  const payload =
    typeof row.payload === "string"
      ? safeJsonParse(row.payload)
      : (row.payload as Record<string, unknown>) ?? {};
  const role = extractRole(payload);
  return {
    seq: row.id,
    ts: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    eventType: row.event_type,
    role,
    payload
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

function extractRole(payload: Record<string, unknown>): string {
  if (typeof payload.roleId === "string") return payload.roleId;
  if (typeof payload.role === "string") return payload.role;
  return "";
}

/** Test-only — drops the cached pool so subsequent calls re-read env. */
export function _resetListProjectEventsForTests(): void {
  _pool = null;
}
