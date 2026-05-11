CREATE TABLE "spec_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"up_to_event_id" bigint NOT NULL,
	"graph_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_spec_snapshots_project_created_at_desc" ON "spec_snapshots" USING btree ("project_id","created_at");