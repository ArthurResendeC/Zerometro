CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`igdb_id` integer NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_igdb_id_unique` ON `companies` (`igdb_id`);--> statement-breakpoint
CREATE TABLE `game_companies` (
	`game_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`developer` integer DEFAULT false NOT NULL,
	`publisher` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`game_id`, `company_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_companies_company_idx` ON `game_companies` (`company_id`);--> statement-breakpoint
CREATE TABLE `game_series` (
	`game_id` integer NOT NULL,
	`series_id` integer NOT NULL,
	PRIMARY KEY(`game_id`, `series_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_series_series_idx` ON `game_series` (`series_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`igdb_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_kind_igdb_idx` ON `series` (`kind`,`igdb_id`);--> statement-breakpoint
ALTER TABLE `games` ADD `themes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `game_modes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `perspectives` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `meta_version` integer DEFAULT 0 NOT NULL;