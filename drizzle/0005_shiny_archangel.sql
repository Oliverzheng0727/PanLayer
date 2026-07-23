CREATE TABLE `job_leases` (
	`job` text NOT NULL,
	`trade_date` text NOT NULL,
	`token` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`job`, `trade_date`)
);
