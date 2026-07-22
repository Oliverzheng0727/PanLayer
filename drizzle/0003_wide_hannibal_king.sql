CREATE TABLE `user_etf_watchlist` (
	`user_email` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`exchange` text NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_email`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `user_etf_watchlist_email_idx` ON `user_etf_watchlist` (`user_email`,`created_at`);