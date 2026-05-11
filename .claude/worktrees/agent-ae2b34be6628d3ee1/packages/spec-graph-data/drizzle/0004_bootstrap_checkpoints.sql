CREATE TABLE bootstrap_checkpoints (
  project_id  uuid PRIMARY KEY REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  ritual_id   text NOT NULL
);
COMMENT ON TABLE bootstrap_checkpoints IS 'One row per project; absent = first ritual not yet bootstrapped.';
