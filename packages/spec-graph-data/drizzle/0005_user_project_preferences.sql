CREATE TABLE user_project_preferences (
  user_id     text NOT NULL,
  project_id  uuid NOT NULL REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  persona     text NOT NULL CHECK (persona IN ('ama', 'diego', 'priya')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);
COMMENT ON TABLE user_project_preferences IS 'Per-user, per-project persona override. Absent → use user default from Clerk metadata.';
