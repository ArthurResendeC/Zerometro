CREATE TABLE `ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`completion_id` integer,
	`scores` text NOT NULL,
	`criterion_notes` text,
	`weights` text NOT NULL,
	`preset` text NOT NULL,
	`enjoyment` real NOT NULL,
	`weighted` real,
	`final` real NOT NULL,
	`mode` text NOT NULL,
	`review` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completion_id`) REFERENCES `completions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ratings_enjoyment_range" CHECK("ratings"."enjoyment" between 0 and 10),
	CONSTRAINT "ratings_final_range" CHECK("ratings"."final" between 0 and 10)
);
--> statement-breakpoint
CREATE INDEX `ratings_user_game_created_idx` ON `ratings` (`user_id`,`game_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_library_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`status` text NOT NULL,
	`platform_played` text,
	`emulated_on` text,
	`progress_goal` text,
	`progress_goal_minutes` integer,
	`started_at` text,
	`finished_at` text,
	`rating` real,
	`notes` text,
	`prior_minutes` integer DEFAULT 0 NOT NULL,
	`playtime_source` text DEFAULT 'sessions' NOT NULL,
	`steam_minutes` integer,
	`steam_synced_at` text,
	`steam_counted_minutes` integer,
	`steam_counted_at` text,
	`acquired_on` text,
	`price_paid_cents` integer,
	`store` text,
	`via_subscription` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_entries_rating_range" CHECK("__new_library_entries"."rating" is null or "__new_library_entries"."rating" between 0 and 10),
	CONSTRAINT "library_entries_prior_minutes_non_negative" CHECK("__new_library_entries"."prior_minutes" >= 0),
	CONSTRAINT "library_entries_price_non_negative" CHECK("__new_library_entries"."price_paid_cents" is null or "__new_library_entries"."price_paid_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_library_entries`("id", "user_id", "game_id", "status", "platform_played", "emulated_on", "progress_goal", "progress_goal_minutes", "started_at", "finished_at", "rating", "notes", "prior_minutes", "playtime_source", "steam_minutes", "steam_synced_at", "steam_counted_minutes", "steam_counted_at", "acquired_on", "price_paid_cents", "store", "via_subscription", "created_at", "updated_at") SELECT "id", "user_id", "game_id", "status", "platform_played", "emulated_on", "progress_goal", "progress_goal_minutes", "started_at", "finished_at", "rating", "notes", "prior_minutes", "playtime_source", "steam_minutes", "steam_synced_at", "steam_counted_minutes", "steam_counted_at", "acquired_on", "price_paid_cents", "store", "via_subscription", "created_at", "updated_at" FROM `library_entries`;--> statement-breakpoint
DROP TABLE `library_entries`;--> statement-breakpoint
ALTER TABLE `__new_library_entries` RENAME TO `library_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `library_entries_user_game_idx` ON `library_entries` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `library_entries_user_status_idx` ON `library_entries` (`user_id`,`status`);