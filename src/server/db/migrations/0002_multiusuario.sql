CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
-- Dados de antes do login ganham um dono provisório; o primeiro login do dono os adota
-- (ver adoptLegacyData em src/server/auth.ts). Banco vazio não cria o usuário provisório.
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`)
SELECT 'legacy-owner', 'Dados anteriores ao login', 'legacy-owner@zerometro.invalid', 0
WHERE EXISTS (SELECT 1 FROM `library_entries`)
   OR EXISTS (SELECT 1 FROM `play_sessions`)
   OR EXISTS (SELECT 1 FROM `kv` WHERE `key` = 'settings');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_library_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`status` text NOT NULL,
	`platform_played` text,
	`started_at` text,
	`finished_at` text,
	`rating` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "library_entries_rating_range" CHECK("rating" is null or "rating" between 1 and 10)
);
--> statement-breakpoint
INSERT INTO `__new_library_entries`("id", "user_id", "game_id", "status", "platform_played", "started_at", "finished_at", "rating", "notes", "created_at", "updated_at") SELECT "id", 'legacy-owner', "game_id", "status", "platform_played", "started_at", "finished_at", "rating", "notes", "created_at", "updated_at" FROM `library_entries`;--> statement-breakpoint
DROP TABLE `library_entries`;--> statement-breakpoint
ALTER TABLE `__new_library_entries` RENAME TO `library_entries`;--> statement-breakpoint
CREATE TABLE `__new_play_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`played_on` text NOT NULL,
	`minutes` integer,
	`started_at` text,
	`ended_at` text,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "play_sessions_minutes_positive" CHECK("minutes" is null or "minutes" > 0),
	CONSTRAINT "play_sessions_active_shape" CHECK(("minutes" is null) = ("started_at" is not null and "ended_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_play_sessions`("id", "user_id", "game_id", "played_on", "minutes", "started_at", "ended_at", "note", "source", "created_at", "updated_at") SELECT "id", 'legacy-owner', "game_id", "played_on", "minutes", "started_at", "ended_at", "note", "source", "created_at", "updated_at" FROM `play_sessions`;--> statement-breakpoint
DROP TABLE `play_sessions`;--> statement-breakpoint
ALTER TABLE `__new_play_sessions` RENAME TO `play_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `library_entries_user_game_idx` ON `library_entries` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `library_entries_user_status_idx` ON `library_entries` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `play_sessions_user_played_on_idx` ON `play_sessions` (`user_id`,`played_on`);--> statement-breakpoint
CREATE INDEX `play_sessions_user_game_played_on_idx` ON `play_sessions` (`user_id`,`game_id`,`played_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `play_sessions_one_active_idx` ON `play_sessions` (`user_id`) WHERE "started_at" is not null and "ended_at" is null;--> statement-breakpoint
ALTER TABLE `activity_log` ADD `user_id` text REFERENCES `user`(`id`) ON DELETE cascade;--> statement-breakpoint
UPDATE `activity_log` SET `user_id` = 'legacy-owner' WHERE EXISTS (SELECT 1 FROM `user` WHERE `id` = 'legacy-owner');--> statement-breakpoint
UPDATE `kv` SET `key` = 'settings:legacy-owner' WHERE `key` = 'settings';
