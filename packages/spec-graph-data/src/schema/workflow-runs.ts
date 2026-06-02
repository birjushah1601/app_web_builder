import { integer, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.projectId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull(),
    concurrencyCap: integer("concurrency_cap"),
    dependencyProfile: jsonb("dependency_profile").notNull(),
    // Plan G — optional USD budget for this workflow run. Null = no cap.
    costCapUsd: numeric("cost_cap_usd"),
    // Plan G.2 — frozen final USD cost, written in onSchedulerExit before the
    // per-run LLMUsageTracker is released. Null until first terminal status.
    totalCostUsd: numeric("total_cost_usd"),
    // Plan G.3 — per-role spend breakdown frozen alongside totalCostUsd.
    // Shape: Array<{ roleId: string, totalUsd: number, callCount: number }>.
    // Null until first terminal status (or for legacy rows pre-G.3).
    costBreakdown: jsonb("cost_breakdown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxProject: index("idx_workflow_runs_project").on(t.projectId, t.createdAt),
    idxStatus: index("idx_workflow_runs_status").on(t.status)
  })
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
