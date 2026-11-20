ALTER TABLE `games` ADD `steam_checked_at` text;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `playtime_source` text DEFAULT 'sessions' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `steam_minutes` integer;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `steam_synced_at` text;