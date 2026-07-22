CREATE TABLE `global_market_snapshots` (
	`trade_date` text NOT NULL,
	`symbol` text NOT NULL,
	`label` text NOT NULL,
	`provider` text NOT NULL,
	`market_time` text,
	`received_at` text NOT NULL,
	`value` real,
	`previous_close` real,
	`pct_change` real,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`trade_date`, `symbol`, `provider`)
);
--> statement-breakpoint
CREATE INDEX `global_snapshot_date_idx` ON `global_market_snapshots` (`trade_date`);--> statement-breakpoint
CREATE TABLE `market_source_audits` (
	`trade_date` text NOT NULL,
	`snapshot_time` text NOT NULL,
	`source` text NOT NULL,
	`market_time` text,
	`received_at` text NOT NULL,
	`raw_count` integer NOT NULL,
	`valid_count` integer NOT NULL,
	`invalid_count` integer NOT NULL,
	`coverage_pct` real NOT NULL,
	`direction_agreement_pct` real,
	`price_agreement_pct` real,
	`breadth_difference` integer,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`trade_date`, `snapshot_time`, `source`)
);
--> statement-breakpoint
CREATE INDEX `market_audit_date_idx` ON `market_source_audits` (`trade_date`,`snapshot_time`);