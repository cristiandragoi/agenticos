CREATE TABLE `attribution` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`run_id` text,
	`asset_id` text,
	`prompt_version_id` text,
	`agent_id` text,
	`model` text,
	`provider` text,
	`views` integer DEFAULT 0,
	`watch_time` integer DEFAULT 0,
	`ctr` real DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`conversions` integer DEFAULT 0,
	`revenue` real DEFAULT 0,
	`commission` real DEFAULT 0,
	`cost` real DEFAULT 0,
	`profit` real DEFAULT 0,
	`roi` real DEFAULT 0,
	`confidence` text DEFAULT 'medium',
	`source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attr_camp` ON `attribution` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_attr_run` ON `attribution` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_attr_asset` ON `attribution` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_attr_prompt` ON `attribution` (`prompt_version_id`);--> statement-breakpoint
CREATE INDEX `idx_attr_agent` ON `attribution` (`agent_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`brief_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`product_reference` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`start_at` text,
	`end_at` text,
	`budget` real,
	`spend` real DEFAULT 0,
	`revenue` real DEFAULT 0,
	`commission` real DEFAULT 0,
	`roi` real DEFAULT 0,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_camp_opp` ON `campaigns` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `idx_camp_brief` ON `campaigns` (`brief_id`);--> statement-breakpoint
CREATE INDEX `idx_camp_status` ON `campaigns` (`status`);--> statement-breakpoint
CREATE INDEX `idx_camp_platform` ON `campaigns` (`platform`);