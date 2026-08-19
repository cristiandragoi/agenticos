ALTER TABLE `goal_events` ADD `event_type` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `normalized_status` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `lifecycle_state` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `user_message` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `technical_message` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `file_path` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `command` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `next_action` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `retry_count` integer;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `requires_user_action` integer;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `goal_events` ADD `error_details` text;