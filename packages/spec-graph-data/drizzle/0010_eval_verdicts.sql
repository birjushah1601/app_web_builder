-- packages/spec-graph-data/drizzle/0010_eval_verdicts.sql
create table if not exists eval_verdicts (
  id uuid primary key default gen_random_uuid(),
  ritual_id text not null,
  role_id text not null,
  workflow_run_id uuid,
  workflow_node_id text,
  project_id uuid not null,
  user_id text not null,
  attempt integer not null,
  layer text not null,
  passed boolean not null,
  score numeric(4,2),
  dimensions jsonb,
  failures jsonb,
  fixable_by text,
  feedback_used jsonb,
  user_turn text,
  prior_artifact_hash text,
  output_hash text,
  rubric_version text not null,
  judge_model text,
  judge_input_tokens integer,
  judge_output_tokens integer,
  judge_cost_usd numeric(8,4),
  created_at timestamptz not null default now()
);

create index if not exists idx_eval_verdicts_ritual on eval_verdicts (ritual_id, created_at);
create index if not exists idx_eval_verdicts_role on eval_verdicts (role_id, passed, created_at);
create index if not exists idx_eval_verdicts_workflow on eval_verdicts (workflow_run_id, workflow_node_id);
create index if not exists idx_eval_verdicts_project on eval_verdicts (project_id, created_at);
create index if not exists idx_eval_verdicts_replay on eval_verdicts (role_id, prior_artifact_hash);
