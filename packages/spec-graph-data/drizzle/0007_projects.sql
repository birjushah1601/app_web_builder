-- Project metadata + user ownership.
--
-- Background: spec_graphs is project-scoped (one row per projectId) and
-- protected by RLS — there is no concept of "the project's owner" in the
-- spec graph itself. The web app needs (a) a stable user→projects mapping
-- so the dashboard can list a user's projects and (b) a human-readable
-- `name` for display. This table covers both with a 1:1 FK to spec_graphs.
--
-- user_id is `text` (not uuid) to match the rest of the codebase: Clerk
-- ids are opaque strings (`user_2abc...`) and Keycloak `sub` claims are
-- UUIDs but treated as opaque text everywhere (see user_project_preferences).
CREATE TABLE projects (
  project_id  uuid PRIMARY KEY REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX projects_user_id_created_at_desc_idx
  ON projects (user_id, created_at DESC);
--> statement-breakpoint
COMMENT ON TABLE projects IS 'Per-project metadata + ownership. One row per spec_graphs row. Read by the dashboard to list a user''s projects.';
