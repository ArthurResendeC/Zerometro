-- Perfis por convite: o `user` ganha papel, @apelido, avatar, senha e versão da sessão; os
-- convites (e links de redefinir senha) ficam em `invites`, só com o hash do código.
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'signup' NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`target_user_id` text,
	`note` text,
	`expires_at` text NOT NULL,
	`used_by` text,
	`used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invites_reset_has_target" CHECK(("invites"."kind" = 'reset') = ("invites"."target_user_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `user` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `user` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `user` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `user` ADD `session_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_handle_idx` ON `user` (`handle`) WHERE "user"."handle" is not null;--> statement-breakpoint
-- Uma instância, vários perfis (por convite). O dono de antes vira o admin, com os dados de sempre:
-- nenhuma linha de jogo muda de dono.
UPDATE `user` SET `role` = 'admin', `handle` = 'owner' WHERE `id` = 'owner';
