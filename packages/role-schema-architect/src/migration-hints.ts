import type { Entity } from "./types.js";

const GROWTH_ENTITY_NAMES = new Set([
  "user",
  "users",
  "post",
  "posts",
  "event",
  "events",
  "transaction",
  "transactions",
  "order",
  "orders",
  "message",
  "messages"
]);

export function generateMigrationHints(e: Entity): string[] {
  const hints: string[] = [];

  // CONCURRENTLY fires on anything that's likely to hold real data:
  // - explicitly partitioned tables (always)
  // - growth-table names (user/post/event/transaction/order/message — any of
  //   these will hold rows in prod, and a non-concurrent index lock blocks
  //   writes for the duration of the build)
  // Field count is NOT a reliable proxy for table size — a 4-field `users`
  // table with 50M rows still deadlocks writers without CONCURRENTLY. The
  // previous `fields.length > 5` heuristic missed that entire class.
  const partitioned = e.partitioning !== undefined;
  const growthTable = GROWTH_ENTITY_NAMES.has(e.name);
  const concurrentlyEligible = partitioned || growthTable;

  for (const idx of e.indexes) {
    if (concurrentlyEligible) {
      hints.push(
        `Use CREATE INDEX CONCURRENTLY when applying '${idx.name}' on '${e.name}' to avoid blocking writes on a populated table.`
      );
    }
    if (idx.unique) {
      hints.push(
        `Pre-flight uniqueness check before creating unique index '${idx.name}' on '${e.name}' — production data may already violate it.`
      );
    }
  }

  if (GROWTH_ENTITY_NAMES.has(e.name)) {
    for (const f of e.fields) {
      if (!f.nullable && f.default === undefined && !isPkColumn(e, f.name)) {
        hints.push(
          `For new required column '${f.name}' on growth-table '${e.name}': add as NULLable → backfill in batches → ALTER COLUMN SET NOT NULL once backfill is verified.`
        );
      }
    }
  }

  if (e.primaryKey.strategy === "serial" && GROWTH_ENTITY_NAMES.has(e.name)) {
    hints.push(
      `'${e.name}' uses serial PK on a growth table — plan the zero-downtime swap to bigint identity (add bigint col → backfill → swap PK → drop old col).`
    );
  }

  return hints;
}

function isPkColumn(e: Entity, fieldName: string): boolean {
  return e.primaryKey.columns.includes(fieldName);
}
