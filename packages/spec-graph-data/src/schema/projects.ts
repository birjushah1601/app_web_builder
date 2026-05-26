import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { specGraphs } from "./spec-graphs.js";

/** Minimal Drizzle table stub for `projects`. The authoritative migration is
 *  0007_projects.sql. This stub exists so other schemas in this package can
 *  declare FK references (e.g. workflow_runs.project_id → projects.project_id)
 *  without reaching outside the package. */
export const projects = pgTable("projects", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => specGraphs.projectId, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
