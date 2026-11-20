CREATE TABLE `completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`type` text NOT NULL,
	`completed_on` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `completions_user_game_completed_on_idx` ON `completions` (`user_id`,`game_id`,`completed_on`);--> statement-breakpoint
CREATE INDEX `completions_user_completed_on_idx` ON `completions` (`user_id`,`completed_on`);--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`description` text,
	`icon_url` text,
	`rarity` real,
	`target` integer DEFAULT 1 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`unlocked_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "objectives_target_positive" CHECK("objectives"."target" >= 1),
	CONSTRAINT "objectives_progress_range" CHECK("objectives"."progress" between 0 and "objectives"."target")
);
--> statement-breakpoint
CREATE INDEX `objectives_user_game_idx` ON `objectives` (`user_id`,`game_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `objectives_external_idx` ON `objectives` (`user_id`,`game_id`,`source`,`external_id`) WHERE "objectives"."external_id" is not null;--> statement-breakpoint
-- Cada jogo zerado vira uma conclusão da história, na data de término (sem data: o dia da última
-- atualização da entrada em São Paulo, UTC-3). Idempotente: não duplica se o jogo já tiver conclusão.
INSERT INTO `completions` (`user_id`, `game_id`, `type`, `completed_on`)
SELECT `e`.`user_id`, `e`.`game_id`, 'main', coalesce(`e`.`finished_at`, date(`e`.`updated_at`, '-3 hours'))
FROM `library_entries` `e`
WHERE `e`.`status` = 'finished'
  AND NOT EXISTS (
    SELECT 1 FROM `completions` `c` WHERE `c`.`user_id` = `e`.`user_id` AND `c`.`game_id` = `e`.`game_id`
  );
