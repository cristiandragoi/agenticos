CREATE TABLE `knowledge_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`predicate` text NOT NULL,
	`object_id` text NOT NULL,
	`object_type` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_know_edge_subj` ON `knowledge_edges` (`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_know_edge_obj` ON `knowledge_edges` (`object_id`);--> statement-breakpoint
CREATE INDEX `idx_know_edge_pred` ON `knowledge_edges` (`predicate`);--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`timestamp` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sys_events_type` ON `system_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_sys_events_source` ON `system_events` (`source`);--> statement-breakpoint
CREATE INDEX `idx_sys_events_processed` ON `system_events` (`processed`);--> statement-breakpoint
CREATE TABLE `treasury_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`source` text NOT NULL,
	`campaign_id` text,
	`run_id` text,
	`timestamp` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_treasury_camp` ON `treasury_ledger` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_treasury_run` ON `treasury_ledger` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_treasury_type` ON `treasury_ledger` (`transaction_type`);