CREATE TABLE `structured_market_signals` (
	`trade_date` text NOT NULL,
	`dataset` text NOT NULL,
	`provider` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`market_time` text,
	`received_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `dataset`, `provider`)
);
