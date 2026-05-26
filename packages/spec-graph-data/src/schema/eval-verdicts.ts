// packages/spec-graph-data/src/schema/eval-verdicts.ts
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const evalVerdicts = pgTable(
  "eval_verdicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ritualId: text("ritual_id").notNull(),
    roleId: text("role_id").notNull(),
    workflowRunId: uuid("workflow_run_id"),
    workflowNodeId: text("workflow_node_id"),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    attempt: integer("attempt").notNull(),
    layer: text("layer").notNull(),
    passed: boolean("passed").notNull(),
    score: numeric("score", { precision: 4, scale: 2 }),
    dimensions: jsonb("dimensions"),
    failures: jsonb("failures"),
    fixableBy: text("fixable_by"),
    feedbackUsed: jsonb("feedback_used"),
    userTurn: text("user_turn"),
    priorArtifactHash: text("prior_artifact_hash"),
    outputHash: text("output_hash"),
    rubricVersion: text("rubric_version").notNull(),
    judgeModel: text("judge_model"),
    judgeInputTokens: integer("judge_input_tokens"),
    judgeOutputTokens: integer("judge_output_tokens"),
    judgeCostUsd: numeric("judge_cost_usd", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRitual: index("idx_eval_verdicts_ritual").on(t.ritualId, t.createdAt),
    idxRole: index("idx_eval_verdicts_role").on(t.roleId, t.passed, t.createdAt),
    idxWorkflow: index("idx_eval_verdicts_workflow").on(t.workflowRunId, t.workflowNodeId),
    idxProject: index("idx_eval_verdicts_project").on(t.projectId, t.createdAt),
    idxReplay: index("idx_eval_verdicts_replay").on(t.roleId, t.priorArtifactHash)
  })
);

export type EvalVerdictRow = typeof evalVerdicts.$inferSelect;
export type NewEvalVerdictRow = typeof evalVerdicts.$inferInsert;
