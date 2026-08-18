CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer,
	`role` text NOT NULL,
	`message_type` text DEFAULT 'message' NOT NULL,
	`content` text NOT NULL,
	`status` text,
	`routed_agent` text,
	`run_id` text,
	`goal_id` text,
	`parent_message_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conv_msg_conv` ON `conversation_messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`primary_agent` text,
	`active_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
