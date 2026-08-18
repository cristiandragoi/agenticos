ALTER TABLE `generated_assets` ADD `previous_version_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `actual_cost` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `dependencies` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `brief_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `budget_limit` real;