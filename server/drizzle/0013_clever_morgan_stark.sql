PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_goal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`sequence_id` integer NOT NULL,
	`timestamp` text NOT NULL,
	`state` text NOT NULL,
	`step` integer NOT NULL,
	`message` text NOT NULL,
	`provider` text DEFAULT 'unknown' NOT NULL,
	`model` text DEFAULT 'unknown' NOT NULL,
	`tool` text,
	`checkpoint_id` text,
	`error` text,
	`event_type` text,
	`normalized_status` text,
	`lifecycle_state` text,
	`user_message` text,
	`technical_message` text,
	`duration_ms` integer,
	`file_path` text,
	`command` text,
	`next_action` text,
	`retry_count` integer,
	`requires_user_action` integer,
	`error_code` text,
	`error_details` text,
	`event_schema_version` integer DEFAULT 1 NOT NULL,
	`operation_id` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_goal_events`("id", "goal_id", "sequence_id", "timestamp", "state", "step", "message", "provider", "model", "tool", "checkpoint_id", "error", "event_type", "normalized_status", "lifecycle_state", "user_message", "technical_message", "duration_ms", "file_path", "command", "next_action", "retry_count", "requires_user_action", "error_code", "error_details", "event_schema_version", "operation_id") SELECT "id", "goal_id", "sequence_id", "timestamp", "state", "step", "message", "provider", "model", "tool", "checkpoint_id", "error", "event_type", "normalized_status", "lifecycle_state", "user_message", "technical_message", "duration_ms", "file_path", "command", "next_action", "retry_count", "requires_user_action", "error_code", "error_details", 1 as "event_schema_version", NULL as "operation_id" FROM `goal_events`;--> statement-breakpoint
DROP TABLE `goal_events`;--> statement-breakpoint
ALTER TABLE `__new_goal_events` RENAME TO `goal_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `goals` ADD `run_summary` text;