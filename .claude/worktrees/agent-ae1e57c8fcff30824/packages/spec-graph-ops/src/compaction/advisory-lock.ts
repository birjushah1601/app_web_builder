import type { Pool } from "pg";

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Compute a stable 32-bit lock key for a project. Postgres advisory locks
 * accept a single bigint or a pair of ints; we use the single-bigint form,
 * populated from hashtext on the server side when called via SQL. For the
 * client-side helper we pre-compute a JS integer hash to avoid a round-trip.
 */
export function projectLockKey(projectId: string): number {
  const input = `atlas.compact:${projectId}`;
  // FNV-1a 32-bit; deterministic, dependency-free, fits in a Postgres int4.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export async function withAdvisoryLock<T>(
  pool: Pool,
  key: number,
  fn: () => Promise<T>
): Promise<LockResult<T>> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS got",
      [key]
    );
    if (!rows[0]?.got) {
      return { acquired: false };
    }
    try {
      const value = await fn();
      return { acquired: true, value };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {
        /* swallow */
      });
    }
  } finally {
    client.release();
  }
}
