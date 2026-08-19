CREATE TABLE `revenue_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`expected_yield` real,
	`actual_yield` real,
	`clicks` integer,
	`conversions` integer,
	`revenue` real,
	`status` text DEFAULT 'measuring' NOT NULL,
	`measured_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `revenue_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rev_metrics_opportunity` ON `revenue_metrics` (`opportunity_id`);
