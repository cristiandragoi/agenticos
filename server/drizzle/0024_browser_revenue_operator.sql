CREATE TABLE IF NOT EXISTS `revenue_browser_provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`account_identifier` text NOT NULL,
	`profile_path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`circuit_breaker_state` text,
	`hourly_action_limit` integer DEFAULT 120 NOT NULL,
	`daily_action_limit` integer DEFAULT 1000 NOT NULL,
	`hourly_action_count` integer DEFAULT 0 NOT NULL,
	`daily_action_count` integer DEFAULT 0 NOT NULL,
	`last_action_at` text,
	`total_earnings` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bp_accounts_provider` ON `revenue_browser_provider_accounts` (`provider_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bp_accounts_status` ON `revenue_browser_provider_accounts` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_rev_bp_accounts_provider_acc` ON `revenue_browser_provider_accounts` (`provider_id`, `account_identifier`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revenue_browser_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_account_id` text REFERENCES `revenue_browser_provider_accounts`(`id`),
	`pid` integer,
	`status` text DEFAULT 'SPAWNING' NOT NULL,
	`current_task_id` text,
	`last_heartbeat_at` text,
	`heartbeat_payload` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`spawned_at` text NOT NULL,
	`terminated_at` text,
	`exit_code` integer,
	`exit_signal` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bw_status` ON `revenue_browser_workers` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bw_account` ON `revenue_browser_workers` (`provider_account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bw_heartbeat` ON `revenue_browser_workers` (`last_heartbeat_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revenue_browser_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`provider_account_id` text REFERENCES `revenue_browser_provider_accounts`(`id`),
	`external_task_id` text NOT NULL,
	`task_type` text NOT NULL,
	`target_url` text NOT NULL,
	`action_payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`expected_reward` real DEFAULT 0 NOT NULL,
	`actual_reward` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`claimed_by_worker_id` text REFERENCES `revenue_browser_workers`(`id`),
	`lease_expires_at` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`completed_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_rev_bt_prov_acc_ext` ON `revenue_browser_tasks` (`provider_id`, `provider_account_id`, `external_task_id`);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bt_status` ON `revenue_browser_tasks` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bt_lease_expires` ON `revenue_browser_tasks` (`lease_expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bt_worker` ON `revenue_browser_tasks` (`claimed_by_worker_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revenue_browser_task_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL REFERENCES `revenue_browser_tasks`(`id`),
	`worker_id` text NOT NULL REFERENCES `revenue_browser_workers`(`id`),
	`provider_account_id` text REFERENCES `revenue_browser_provider_accounts`(`id`),
	`attempt_number` integer NOT NULL,
	`status` text NOT NULL,
	`reward_expected` real DEFAULT 0 NOT NULL,
	`reward_earned` real DEFAULT 0 NOT NULL,
	`error_code` text,
	`error` text,
	`duration_ms` integer,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bta_task` ON `revenue_browser_task_attempts` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bta_worker` ON `revenue_browser_task_attempts` (`worker_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_bta_account` ON `revenue_browser_task_attempts` (`provider_account_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revenue_browser_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text REFERENCES `revenue_browser_tasks`(`id`),
	`worker_id` text NOT NULL REFERENCES `revenue_browser_workers`(`id`),
	`provider_account_id` text REFERENCES `revenue_browser_provider_accounts`(`id`),
	`action_type` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`policy_decision` text,
	`screenshot_path` text,
	`execution_duration_ms` integer,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_btrace_worker` ON `revenue_browser_traces` (`worker_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rev_btrace_task` ON `revenue_browser_traces` (`task_id`);
