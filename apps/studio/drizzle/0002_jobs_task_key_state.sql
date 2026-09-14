ALTER TABLE "jobs" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "provider_state" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "key" text;--> statement-breakpoint
CREATE INDEX "jobs_workspace_key_idx" ON "jobs" USING btree ("workspace_id","key");