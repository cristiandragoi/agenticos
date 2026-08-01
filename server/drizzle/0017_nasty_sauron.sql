CREATE TABLE `agent_provider_assignments` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`routing_mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gateway_configuration` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_provider_retries` integer DEFAULT 3 NOT NULL,
	`max_fallback_providers` integer DEFAULT 3 NOT NULL,
	`provider_timeout_ms` integer DEFAULT 30000 NOT NULL,
	`degraded_latency_ms` integer DEFAULT 2000 NOT NULL,
	`circuit_failure_threshold` integer DEFAULT 5 NOT NULL,
	`circuit_reset_timeout_ms` integer DEFAULT 60000 NOT NULL,
	`health_check_interval_ms` integer DEFAULT 300000 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`configured` integer DEFAULT false NOT NULL,
	`masked_preview` text,
	`validation_status` text,
	`last_validated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `goals` ADD `execution_options` text;