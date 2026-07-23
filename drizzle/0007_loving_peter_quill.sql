CREATE TABLE `new_high_states` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`last_date` text NOT NULL,
	`last_close` real NOT NULL,
	`closes_json` text NOT NULL,
	`all_time_high` real NOT NULL,
	`all_time_high_date` text NOT NULL,
	`first_close` real NOT NULL,
	`initialized_through` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `new_high_states_progress_idx` ON `new_high_states` (`status`,`initialized_through`);