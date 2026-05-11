import { sql } from "drizzle-orm";
import { bigint, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const specGraphs = pgTable(
  "spec_graphs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    graphData: jsonb("graph_data").notNull().default({}),
    // drizzle-kit cannot JSON-serialize BigInt literals in schema diffs,
    // so the default is expressed as a SQL literal.
    currentEventSeq: bigint("current_event_seq", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uqProject: uniqueIndex("uq_spec_graphs_project_id").on(table.projectId)
  })
);

export type SpecGraphRow = typeof specGraphs.$inferSelect;
export type NewSpecGraphRow = typeof specGraphs.$inferInsert;
