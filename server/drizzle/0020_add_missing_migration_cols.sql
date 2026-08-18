ALTER TABLE `gateway_configuration` ADD `migration_state` text DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `gateway_configuration` ADD `migration_owner` text;
--> statement-breakpoint
ALTER TABLE `gateway_configuration` ADD `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `gateway_configuration` ADD `migration_version` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `provider_credentials` ADD `migration_state` text DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `provider_credentials` ADD `migration_owner` text;
--> statement-breakpoint
ALTER TABLE `provider_credentials` ADD `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `provider_credentials` ADD `migration_version` integer DEFAULT 1;
