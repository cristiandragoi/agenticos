CREATE TABLE `goal_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`sequence_id` integer NOT NULL,
	`step_id` text,
	`step_index` integer,
	`goal_status` text,
	`execution_phase` text,
	`workspace_snapshot` text,
	`workspace_hash` text,
	`changed_files` text,
	`execution_context` text,
	`provider_state` text,
	`validation_state` text,
	`budget_state` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
