import { bigint, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowUsage = pgTable(
  "workflow_usage",
  {
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRun: index("idx_workflow_usage_run").on(t.workflowRunId, t.recordedAt)
  })
);

export type WorkflowUsageRow = typeof workflowUsage.$inferSelect;
export type NewWorkflowUsageRow = typeof workflowUsage.$inferInsert;
