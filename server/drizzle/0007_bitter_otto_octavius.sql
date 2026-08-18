CREATE TABLE `goal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`sequence_id` integer NOT NULL,
	`timestamp` text NOT NULL,
	`state` text NOT NULL,
	`step` integer NOT NULL,
	`message` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`tool` text,
	`checkpoint_id` text,
	`error` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `goal_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`status` text NOT NULL,
	`tool_call` text,
	`tool_result` text,
	`error` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`original_goal` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`provider_fallback_count` integer DEFAULT 0 NOT NULL,
	`active_checkpoint_id` text,
	`worker_id` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_circuit_breakers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`cooldown_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `skills` ADD `is_public` integer DEFAULT true NOT NULL;