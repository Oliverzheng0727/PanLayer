CREATE TABLE `new_high_details` (
	`trade_date` text NOT NULL,
	`type` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`pct_change` real NOT NULL,
	`close` real NOT NULL,
	`high_price` real NOT NULL,
	`amount` real NOT NULL,
	`interval_pct` real NOT NULL,
	`high_date` text NOT NULL,
	`is_all_time` integer NOT NULL,
	PRIMARY KEY(`trade_date`, `type`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `new_high_date_idx` ON `new_high_details` (`trade_date`,`type`);