CREATE TABLE `bootstrap_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `breadth_snapshots` (
	`trade_date` text NOT NULL,
	`snapshot_time` text NOT NULL,
	`rising` integer NOT NULL,
	`falling` integer NOT NULL,
	`flat` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `snapshot_time`)
);
--> statement-breakpoint
CREATE TABLE `daily_reviews` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `etf_snapshots` (
	`trade_date` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`price` text NOT NULL,
	`pct_change` text NOT NULL,
	`amount` text NOT NULL,
	`scale` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `etf_trade_date_idx` ON `etf_snapshots` (`trade_date`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`trade_date` text NOT NULL,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_date_idx` ON `job_runs` (`trade_date`,`job`);--> statement-breakpoint
CREATE TABLE `morning_briefs` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stocks` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`exchange` text NOT NULL,
	`board` text NOT NULL,
	`sector` text DEFAULT '未分类' NOT NULL,
	`updated_at` text NOT NULL
);
