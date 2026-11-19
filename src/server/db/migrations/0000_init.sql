CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_log_created_at_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`igdb_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`cover_image_id` text,
	`platforms` text DEFAULT '[]' NOT NULL,
	`genres` text DEFAULT '[]' NOT NULL,
	`release_year` integer,
	`ttb_main_sec` integer,
	`ttb_extra_sec` integer,
	`ttb_complete_sec` integer,
	`ttb_source` text,
	`synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_igdb_id_unique` ON `games` (`igdb_id`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`status` text NOT NULL,
	`platform_played` text,
	`started_at` text,
	`finished_at` text,
	`rating` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_entries_rating_range" CHECK("library_entries"."rating" is null or "library_entries"."rating" between 1 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_entries_game_id_unique` ON `library_entries` (`game_id`);--> statement-breakpoint
CREATE INDEX `library_entries_status_idx` ON `library_entries` (`status`);--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`played_on` text NOT NULL,
	`minutes` integer NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "play_sessions_minutes_positive" CHECK("play_sessions"."minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX `play_sessions_played_on_idx` ON `play_sessions` (`played_on`);--> statement-breakpoint
CREATE INDEX `play_sessions_game_played_on_idx` ON `play_sessions` (`game_id`,`played_on`);