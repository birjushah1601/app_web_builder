-- Plan G.3 — per-role cost breakdown surfaced on the run snapshot after
-- terminal status. Filled in WorkflowEngine.buildSchedulerDeps.onSchedulerExit
-- next to total_cost_usd, before the per-run LLMUsageTracker is released.
-- Null = never computed (legacy rows / runs that never reached terminal state).
-- Shape: Array<{ roleId: string, totalUsd: number, callCount: number }>.
ALTER TABLE workflow_runs ADD COLUMN cost_breakdown jsonb;
