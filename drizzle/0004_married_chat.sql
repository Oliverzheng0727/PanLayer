CREATE TABLE `morning_brief_sections` (
	`trade_date` text NOT NULL,
	`section_key` text NOT NULL,
	`model` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`generated_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`trade_date`, `section_key`)
);
