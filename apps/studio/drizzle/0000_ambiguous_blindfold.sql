CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"name" text DEFAULT 'Untitled' NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"graph_id" text,
	"node_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"provider_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"cost" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assets_workspace_idx" ON "assets" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "graphs_workspace_updated_idx" ON "graphs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "jobs_workspace_status_idx" ON "jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "jobs_provider_id_idx" ON "jobs" USING btree ("provider","provider_id");