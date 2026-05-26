-- F1: Add FK from workflow_runs.project_id → projects(project_id) ON DELETE CASCADE.
-- The projects table uses project_id (not id) as its primary key.
alter table workflow_runs add constraint workflow_runs_project_id_fkey
  foreign key (project_id) references projects(project_id) on delete cascade;
