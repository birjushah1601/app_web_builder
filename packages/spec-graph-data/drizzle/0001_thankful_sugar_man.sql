CREATE TABLE "spec_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_spec_events_project_id_desc" ON "spec_events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "idx_spec_events_project_created_at_desc" ON "spec_events" USING btree ("project_id","created_at");