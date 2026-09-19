CREATE TABLE "agent_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"graph_id" text,
	"model" text NOT NULL,
	"billing" text,
	"hold_micros" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"model_micros" bigint,
	"fee_micros" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"graph_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"messages" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "turn_id" text;--> statement-breakpoint
CREATE INDEX "agent_turns_workspace_created_idx" ON "agent_turns" USING btree ("workspace_id","created_at");