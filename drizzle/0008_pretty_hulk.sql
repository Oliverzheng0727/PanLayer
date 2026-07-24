CREATE TABLE IF NOT EXISTS `brief_fetch_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`fetch_date` text NOT NULL,
	`source_tier` integer NOT NULL,
	`transport` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`source_total` integer NOT NULL,
	`source_success` integer NOT NULL,
	`raw_item_count` integer NOT NULL,
	`kept_item_count` integer NOT NULL,
	`filtered_item_count` integer NOT NULL,
	`error_summary_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `brief_fetch_runs_date_tier_idx` ON `brief_fetch_runs` (`fetch_date`,`source_tier`,`finished_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brief_items` (
	`item_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`published_at` text,
	`received_at` text NOT NULL,
	`fetch_date` text NOT NULL,
	`run_id` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`source_names_json` text NOT NULL,
	`industry_keys_json` text NOT NULL,
	`source_tier` integer NOT NULL,
	`verification_status` text NOT NULL,
	`corroborating_urls_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`filter_status` text NOT NULL,
	`filter_reason` text,
	PRIMARY KEY(`fetch_date`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `brief_items_date_run_idx` ON `brief_items` (`fetch_date`,`run_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brief_sources` (
	`source_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`industry_keys_json` text NOT NULL,
	`source_tier` integer NOT NULL,
	`transport` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` text,
	`last_success_at` text,
	`last_error` text,
	`latency_ms` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `brief_sources_url_tier_idx` ON `brief_sources` (`url`,`source_tier`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_checkpoints` (
	`trade_date` text NOT NULL,
	`job_key` text NOT NULL,
	`stage` text DEFAULT 'main' NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`expected_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`next_retry_at` text,
	`message` text DEFAULT '' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `job_key`, `stage`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_checkpoints_due_idx` ON `job_checkpoints` (`trade_date`,`status`,`next_retry_at`);
