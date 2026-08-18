CREATE TABLE `generated_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`job_id` text,
	`asset_type` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`file_reference` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`validation_result` text,
	`compliance_result` text,
	`metadata` text,
	`created_by_agent_id` text,
	`created_by_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gen_asset_brief` ON `generated_assets` (`brief_id`);--> statement-breakpoint
CREATE INDEX `idx_gen_asset_status` ON `generated_assets` (`status`);--> statement-breakpoint
CREATE INDEX `idx_gen_asset_job` ON `generated_assets` (`job_id`);--> statement-breakpoint
CREATE TABLE `production_brief_events` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `production_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`objective` text,
	`target_platform` text,
	`target_audience` text,
	`product_summary` text,
	`value_proposition` text,
	`content_type` text,
	`requested_asset_count` integer DEFAULT 1,
	`language` text DEFAULT 'en',
	`tone` text,
	`key_benefits` text,
	`approved_claims` text,
	`prohibited_claims` text,
	`required_disclosures` text,
	`content_angles` text,
	`source_evidence` text,
	`success_metrics` text,
	`estimated_generation_cost` real,
	`actual_generation_cost` real,
	`execution_plan` text,
	`created_by` text,
	`created_by_run_id` text,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prod_brief_opp` ON `production_briefs` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `idx_prod_brief_status` ON `production_briefs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_prod_brief_platform` ON `production_briefs` (`target_platform`);--> statement-breakpoint
CREATE INDEX `idx_prod_brief_created_at` ON `production_briefs` (`created_at`);