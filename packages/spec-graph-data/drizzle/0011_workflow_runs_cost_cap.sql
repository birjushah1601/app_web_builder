-- Plan G — per-workflow USD cost cap. Null = no cap (default).
ALTER TABLE workflow_runs ADD COLUMN cost_cap_usd numeric;
