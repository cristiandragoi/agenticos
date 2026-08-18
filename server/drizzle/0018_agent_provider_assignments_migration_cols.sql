ALTER TABLE `agent_provider_assignments` ADD `migration_state` text DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `agent_provider_assignments` ADD `migration_owner` text;
--> statement-breakpoint
ALTER TABLE `agent_provider_assignments` ADD `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `agent_provider_assignments` ADD `migration_version` integer DEFAULT 1;
