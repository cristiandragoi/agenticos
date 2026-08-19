ALTER TABLE `goal_events` RENAME COLUMN "sequence_id" TO "sequence";--> statement-breakpoint
CREATE TABLE `agent_team_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`team_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`handoff_id` text,
	`path` text NOT NULL,
	`checksum` text NOT NULL,
	`checksum_algorithm` text DEFAULT 'sha256' NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text,
	`created_at` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `team_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_team_artifacts_run` ON `agent_team_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_team_artifacts_run_agent` ON `agent_team_artifacts` (`run_id`,`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_team_artifacts_run_path_checksum` ON `agent_team_artifacts` (`run_id`,`path`,`checksum`);--> statement-breakpoint
CREATE TABLE `agent_team_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`decisions` text,
	`artifacts` text,
	`open_issues` text,
	`recommended_next_actions` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`team_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`verifier_id` text NOT NULL,
	`passed` integer NOT NULL,
	`checks` text NOT NULL,
	`evidence` text NOT NULL,
	`blocking_issues` text,
	`recommended_fixes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `team_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `goal_events` ADD `team_id` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `payload` text;--> statement-breakpoint
CREATE UNIQUE INDEX `goal_events_goal_seq_idx` ON `goal_events` (`goal_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `goal_events_team_seq_idx` ON `goal_events` (`team_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `goal_events_team_agent_seq_idx` ON `goal_events` (`team_id`,`agent_id`,`sequence`);--> statement-breakpoint
ALTER TABLE `goals` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `conversation_id` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `active_agent_id` text;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `current_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `verification_report` text;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `repair_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `checkpoint_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `checkpoint_sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_runs` ADD `database_revision` integer DEFAULT 1 NOT NULL;