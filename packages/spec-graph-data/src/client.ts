import pg, { type Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const { Pool: PgPool } = pg;

export type Schema = typeof schema;
export type DrizzleDb = NodePgDatabase<Schema>;

export interface Database {
  pool: Pool;
  db: DrizzleDb;
}

export function createDatabase(connectionString: string, overrides?: Partial<PoolConfig>): Database {
  const pool = new PgPool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
