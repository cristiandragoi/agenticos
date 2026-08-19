CREATE TABLE `revenue_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text,
	`target_amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`start_date` text NOT NULL,
	`deadline` text NOT NULL,
	`advertising_budget` real DEFAULT 0 NOT NULL,
	`actual_spend` real DEFAULT 0 NOT NULL,
	`enabled_engines` text,
	`available_channels` text,
	`primary_market` text DEFAULT 'DE/EU',
	`status` text DEFAULT 'active' NOT NULL,
	`realized_revenue` real DEFAULT 0 NOT NULL,
	`verified_revenue` real DEFAULT 0 NOT NULL,
	`pipeline_value` real DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`net_revenue` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_mission_project` ON `revenue_missions` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_mission_status` ON `revenue_missions` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_rev_mission_deadline` ON `revenue_missions` (`deadline`);
--> statement-breakpoint
CREATE TABLE `revenue_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`project_id` text,
	`opportunity_id` text,
	`engine` text NOT NULL,
	`hypothesis` text NOT NULL,
	`target_customer` text,
	`problem` text,
	`product` text,
	`offer` text,
	`price` real,
	`evidence` text,
	`evidence_sources` text,
	`confidence` real,
	`competitors` text,
	`distribution_channels` text,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`expected_revenue` real DEFAULT 0 NOT NULL,
	`actual_revenue` real DEFAULT 0 NOT NULL,
	`verified_revenue` real DEFAULT 0 NOT NULL,
	`build_time` text,
	`launch_date` text,
	`impressions` integer DEFAULT 0 NOT NULL,
	`visits` integer DEFAULT 0 NOT NULL,
	`leads` integer DEFAULT 0 NOT NULL,
	`responses` integer DEFAULT 0 NOT NULL,
	`conversions` integer DEFAULT 0 NOT NULL,
	`sales` integer DEFAULT 0 NOT NULL,
	`decision_reason` text,
	`status` text DEFAULT 'DISCOVERED' NOT NULL,
	`goal_ids` text,
	`task_ids` text,
	`run_ids` text,
	`artifact_ids` text,
	`score_payload` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_exp_mission` ON `revenue_experiments` (`mission_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_exp_status` ON `revenue_experiments` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_rev_exp_engine` ON `revenue_experiments` (`engine`);
--> statement-breakpoint
CREATE TABLE `revenue_experiment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`mission_id` text,
	`event_type` text NOT NULL,
	`previous_status` text,
	`next_status` text,
	`actor_type` text,
	`actor_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_exp_events_exp` ON `revenue_experiment_events` (`experiment_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_exp_events_type` ON `revenue_experiment_events` (`event_type`);
--> statement-breakpoint
CREATE TABLE `revenue_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`experiment_id` text,
	`entry_type` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`status` text DEFAULT 'recorded' NOT NULL,
	`evidence` text,
	`provenance` text,
	`source` text,
	`verified_at` text,
	`verified_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_ledger_mission` ON `revenue_ledger_entries` (`mission_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_ledger_exp` ON `revenue_ledger_entries` (`experiment_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_ledger_type` ON `revenue_ledger_entries` (`entry_type`);
--> statement-breakpoint
CREATE TABLE `revenue_distribution_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`capabilities` text,
	`automation_allowed` integer DEFAULT 1 NOT NULL,
	`human_gate_required` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'configured' NOT NULL,
	`config` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revenue_distribution_channels_channel_unique` ON `revenue_distribution_channels` (`channel`);
--> statement-breakpoint
CREATE TABLE `revenue_compliance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text,
	`company_name` text,
	`website` text,
	`contact_email` text,
	`contact_source` text,
	`business_relevance` text,
	`purpose` text,
	`outreach_history` text,
	`opt_out` integer DEFAULT 0 NOT NULL,
	`do_not_contact` integer DEFAULT 0 NOT NULL,
	`suppression_state` text DEFAULT 'none' NOT NULL,
	`retention_state` text DEFAULT 'active' NOT NULL,
	`lawful_basis` text,
	`compliance_review_state` text DEFAULT 'not_required' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_compliance_exp` ON `revenue_compliance_records` (`experiment_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_compliance_suppression` ON `revenue_compliance_records` (`suppression_state`);
--> statement-breakpoint
CREATE TABLE `revenue_human_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text,
	`gate_type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`description` text,
	`branch_paused` integer DEFAULT 0 NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_human_gates_exp` ON `revenue_human_gates` (`experiment_id`);
--> statement-breakpoint
CREATE INDEX `idx_rev_human_gates_status` ON `revenue_human_gates` (`status`);
