ALTER TABLE `library_entries` ADD `steam_counted_minutes` integer;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `steam_counted_at` text;--> statement-breakpoint
-- O que já foi sincronizado vira a base: só o tempo jogado daqui em diante vira sessão.
UPDATE `library_entries` SET `steam_counted_minutes` = `steam_minutes`, `steam_counted_at` = coalesce(`steam_synced_at`, `updated_at`) WHERE `steam_minutes` IS NOT NULL;
