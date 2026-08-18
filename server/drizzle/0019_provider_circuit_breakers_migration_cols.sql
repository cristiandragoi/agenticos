ALTER TABLE `provider_circuit_breakers` ADD `migration_state` text DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `provider_circuit_breakers` ADD `migration_owner` text;
--> statement-breakpoint
ALTER TABLE `provider_circuit_breakers` ADD `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `provider_circuit_breakers` ADD `migration_version` integer DEFAULT 1;
