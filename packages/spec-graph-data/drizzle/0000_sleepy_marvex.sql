CREATE TABLE "spec_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"graph_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_event_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_spec_graphs_project_id" ON "spec_graphs" USING btree ("project_id");