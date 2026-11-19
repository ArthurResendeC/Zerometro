PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_play_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`played_on` text NOT NULL,
	`minutes` integer,
	`started_at` text,
	`ended_at` text,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "play_sessions_minutes_positive" CHECK("minutes" is null or "minutes" > 0),
	CONSTRAINT "play_sessions_active_shape" CHECK(("minutes" is null) = ("started_at" is not null and "ended_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_play_sessions`("id", "game_id", "played_on", "minutes", "started_at", "ended_at", "note", "source", "created_at", "updated_at") SELECT "id", "game_id", "played_on", "minutes", NULL, NULL, "note", "source", "created_at", "updated_at" FROM `play_sessions`;--> statement-breakpoint
DROP TABLE `play_sessions`;--> statement-breakpoint
ALTER TABLE `__new_play_sessions` RENAME TO `play_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `play_sessions_played_on_idx` ON `play_sessions` (`played_on`);--> statement-breakpoint
CREATE INDEX `play_sessions_game_played_on_idx` ON `play_sessions` (`game_id`,`played_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `play_sessions_one_active_idx` ON `play_sessions` (("ended_at" is null)) WHERE "started_at" is not null and "ended_at" is null;