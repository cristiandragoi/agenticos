CREATE TABLE `team_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_agent` text,
	`goal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_prompt` text NOT NULL,
	`team_sheet` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
