-- Itens de personalização (temas, pacotes de som) que cada perfil tem. O que é de graça não tem linha.
CREATE TABLE `user_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`acquired_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_items_user_kind_item_idx` ON `user_items` (`user_id`,`kind`,`item_id`);