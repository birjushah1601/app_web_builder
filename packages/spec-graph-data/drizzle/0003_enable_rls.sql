-- Enable RLS and install per-table policies that filter on the session-local
-- app.project_id setting. The helper `withProjectContext` is the only
-- supported caller. The atlas role is provisioned by the Docker init
-- script (docker/postgres-init.sql) as NOSUPERUSER NOBYPASSRLS so that
-- FORCE ROW LEVEL SECURITY on these tables is actually enforceable.

ALTER TABLE spec_graphs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spec_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spec_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spec_graphs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spec_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE spec_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- current_setting with missing_ok=true returns NULL when unset, which the cast
-- will reject. Wrap in a defensive expression that returns a zero UUID when
-- unset so comparisons never error but also never match a real row.
CREATE OR REPLACE FUNCTION atlas_current_project_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.project_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid
$$;
--> statement-breakpoint
CREATE POLICY spec_graphs_tenant ON spec_graphs
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());
--> statement-breakpoint
CREATE POLICY spec_events_tenant ON spec_events
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());
--> statement-breakpoint
CREATE POLICY spec_snapshots_tenant ON spec_snapshots
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());
