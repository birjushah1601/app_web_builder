create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  prompt text not null,
  status text not null,
  concurrency_cap integer,
  dependency_profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workflow_runs_project on workflow_runs (project_id, created_at);
create index if not exists idx_workflow_runs_status on workflow_runs (status);

create table if not exists workflow_nodes (
  id text not null,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  artifact_kind text not null,
  summary text not null,
  depends_on jsonb not null default '[]'::jsonb,
  consumes jsonb not null default '[]'::jsonb,
  policy jsonb not null,
  status text not null,
  ritual_id text,
  artifact jsonb,
  artifact_schema_version text,
  failure jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  primary key (workflow_run_id, id)
);

create table if not exists workflow_node_checkpoints (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  kind text not null,
  payload jsonb not null,
  ritual_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_workflow_checkpoints_run_node on workflow_node_checkpoints (workflow_run_id, node_id, created_at);

create table if not exists workflow_usage (
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,4) not null default 0,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_workflow_usage_run on workflow_usage (workflow_run_id, recorded_at);
