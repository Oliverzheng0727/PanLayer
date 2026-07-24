CREATE TABLE IF NOT EXISTS `new_high_bootstrap_failures` (
	`symbol` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text NOT NULL,
	`next_retry_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `new_high_bootstrap_retry_idx` ON `new_high_bootstrap_failures` (`next_retry_at`,`attempts`);
