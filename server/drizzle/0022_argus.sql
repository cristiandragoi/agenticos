CREATE TABLE `argus_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`title` text NOT NULL,
	`original_spec` text NOT NULL,
	`acceptance_criteria` text NOT NULL,
	`spec_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_argus_contracts_goal` ON `argus_contracts` (`goal_id`);
--> statement-breakpoint
CREATE TABLE `argus_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`evidence_level` text DEFAULT 'L0' NOT NULL,
	`verdict` text NOT NULL,
	`provider` text,
	`model` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_argus_verifications_contract` ON `argus_verifications` (`contract_id`);
--> statement-breakpoint
CREATE TABLE `argus_defects` (
	`id` text PRIMARY KEY NOT NULL,
	`verification_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`severity` text DEFAULT 'major' NOT NULL,
	`description` text NOT NULL,
	`reproduction` text,
	`expected` text,
	`actual` text,
	`fix_suggestion` text,
	`status` text DEFAULT 'open' NOT NULL,
	`correction_goal_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_argus_defects_status` ON `argus_defects` (`status`);
--> statement-breakpoint
CREATE TABLE `argus_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`defect_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text DEFAULT 'dispatched' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_argus_corrections_contract` ON `argus_corrections` (`contract_id`, `attempt`);
--> statement-breakpoint
ALTER TABLE `goals` ADD `verification_state` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `goals` ADD `contract_id` text;
