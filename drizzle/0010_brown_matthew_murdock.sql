CREATE TABLE `brief_market_evidence` (
	`trade_date` text NOT NULL,
	`provider` text NOT NULL,
	`reference_date` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `provider`)
);
