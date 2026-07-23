CREATE TABLE `etf_catalog_cache` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`received_at` text NOT NULL,
	`updated_at` text NOT NULL
);
