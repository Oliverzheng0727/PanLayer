CREATE TABLE `history_contribution_failures` (
	`symbol` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text NOT NULL,
	`next_retry_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_contribution_retry_idx` ON `history_contribution_failures` (`next_retry_at`,`attempts`);