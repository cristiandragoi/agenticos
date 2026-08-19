CREATE TABLE `revenue_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`opportunity_type` text NOT NULL,
	`source_platform` text,
	`source_url` text,
	`stage` text DEFAULT 'discovered' NOT NULL,
	`research_payload` text,
	`evidence_payload` text,
	`demand_score` real,
	`competition_score` real,
	`profitability_score` real,
	`compliance_risk_score` real,
	`overall_score` real,
	`estimated_revenue` real,
	`estimated_cost` real,
	`currency` text DEFAULT 'USD',
	`owner_agent_id` text,
	`created_by_run_id` text,
	`approval_status` text DEFAULT 'not_required' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`rejection_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_opp_stage` ON `revenue_opportunities` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_rev_opp_approval_status` ON `revenue_opportunities` (`approval_status`);--> statement-breakpoint
CREATE INDEX `idx_rev_opp_type` ON `revenue_opportunities` (`opportunity_type`);--> statement-breakpoint
CREATE INDEX `idx_rev_opp_created_at` ON `revenue_opportunities` (`created_at`);--> statement-breakpoint
CREATE TABLE `revenue_opportunity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`previous_stage` text,
	`next_stage` text,
	`actor_type` text,
	`actor_id` text,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`skill_id` text,
	`tool_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`input` text,
	`output` text,
	`error` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`timezone` text NOT NULL,
	`run_at` text,
	`interval_seconds` integer,
	`cron_expression` text,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` text,
	`last_triggered_at` text,
	`misfire_policy` text DEFAULT 'run_once' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`agent_id` text,
	`tool_id` text,
	`model_hint` text,
	`params_template` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`skill_ids` text NOT NULL,
	`schedule_id` text,
	`input` text,
	`assigned_agent_id` text,
	`requires_approval` integer DEFAULT false NOT NULL,
	`approval_policy_id` text,
	`retry_policy` text,
	`timeout_seconds` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_run_at` text,
	`next_run_at` text
);
