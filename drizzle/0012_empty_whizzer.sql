CREATE TABLE `history_bar_contributions` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_st` integer NOT NULL,
	`first_date` text NOT NULL,
	`target_date` text NOT NULL,
	`bars_json` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_contribution_progress_idx` ON `history_bar_contributions` (`target_date`,`status`);