CREATE TABLE `history_daily_contribution_meta` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`expected_count` integer NOT NULL,
	`valid_count` integer NOT NULL,
	`non_st_count` integer NOT NULL,
	`coverage_pct` real NOT NULL,
	`source` text NOT NULL,
	`market_time` text,
	`received_at` text NOT NULL,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history_daily_contributions` (
	`trade_date` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`is_st` integer NOT NULL,
	`pct_change` real NOT NULL,
	`amount` real,
	`source` text NOT NULL,
	`received_at` text NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`trade_date`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `history_daily_contribution_date_idx` ON `history_daily_contributions` (`trade_date`,`status`,`received_at`);
--> statement-breakpoint
PRAGMA optimize;
