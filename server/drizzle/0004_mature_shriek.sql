CREATE TABLE `agent_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text,
	`source_run_id` text,
	`source_task_id` text,
	`idempotency_key` text,
	`agent_id` text NOT NULL,
	`prompt_version_id` text,
	`provider` text,
	`model` text,
	`input` text,
	`output` text,
	`tool_calls` text,
	`status` text,
	`success` integer,
	`error` text,
	`primary_failure_category` text,
	`secondary_failure_categories` text,
	`compliance_result` text,
	`human_review_score` integer,
	`opportunity_id` text,
	`brief_id` text,
	`asset_id` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`execution_time_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_tokens` integer,
	`total_tokens` integer,
	`estimated_cost` real,
	`actual_cost` real,
	`cost_source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_executions_idempotency_key_unique` ON `agent_executions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_exec_agent` ON `agent_executions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_prompt` ON `agent_executions` (`prompt_version_id`);--> statement-breakpoint
CREATE INDEX `idx_exec_success` ON `agent_executions` (`success`);--> statement-breakpoint
CREATE INDEX `idx_exec_idem` ON `agent_executions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `agent_prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`system_prompt` text NOT NULL,
	`model` text,
	`provider` text,
	`temperature` real,
	`tools` text,
	`skills` text,
	`memory_configuration` text,
	`permissions` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`author` text,
	`reason_for_change` text,
	`parent_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prompt_ver_agent` ON `agent_prompt_versions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_prompt_ver_status` ON `agent_prompt_versions` (`status`);--> statement-breakpoint
CREATE TABLE `evaluation_case_results` (
	`id` text PRIMARY KEY NOT NULL,
	`suite_run_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`execution_id` text,
	`passed` integer,
	`score` integer
);
--> statement-breakpoint
CREATE TABLE `evaluation_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evaluation_suite_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`prompt_version_id` text NOT NULL,
	`status` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evaluation_test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`input` text,
	`expected_output` text,
	`evaluation_rules` text,
	`acceptance_threshold` integer DEFAULT 80 NOT NULL,
	`tags` text,
	`enabled` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `run_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`evaluation_version` text,
	`status` text,
	`deterministic_scores` text,
	`judge_scores` text,
	`task_completion_score` integer,
	`output_quality_score` integer,
	`compliance_score` integer,
	`correctness_score` integer,
	`cost_efficiency_score` integer,
	`speed_score` integer,
	`overall_score` integer,
	`reasons` text,
	`strengths` text,
	`weaknesses` text,
	`recommendations` text,
	`evaluator_provider` text,
	`evaluator_model` text,
	`evaluation_prompt_version` text,
	`evaluation_method` text,
	`evaluation_cost` real,
	`evaluation_duration_ms` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_eval_exec` ON `run_evaluations` (`execution_id`);