-- Plan G.2 — frozen final cost surfaced on the run row after terminal status.
-- Filled in WorkflowEngine.buildSchedulerDeps.onSchedulerExit before the per-run
-- LLMUsageTracker map entry is released. Null = never computed (legacy rows /
-- runs that never reached terminal state).
ALTER TABLE workflow_runs ADD COLUMN total_cost_usd numeric;
