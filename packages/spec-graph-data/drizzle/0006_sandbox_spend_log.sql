CREATE TABLE sandbox_spend_log (
  id           bigserial PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  sandbox_id   text NOT NULL,
  usd_amount   numeric(10, 4) NOT NULL CHECK (usd_amount >= 0),
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX sandbox_spend_log_project_occurred_idx ON sandbox_spend_log (project_id, occurred_at DESC);
--> statement-breakpoint
COMMENT ON TABLE sandbox_spend_log IS 'Append-only ledger of E2B sandbox spend per project. Read by SpendReader to enforce SANDBOX_SPEND_CAP_USD_PER_PROJECT_MONTH.';
