-- Livro-razão das moedas (só inserção): o saldo é a soma; os ganhos de horas e conquistas são recalculados e a diferença entra como ajuste.
CREATE TABLE `coin_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_key` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coin_ledger_amount_not_zero" CHECK("coin_ledger"."amount" <> 0)
);
--> statement-breakpoint
CREATE INDEX `coin_ledger_user_created_idx` ON `coin_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `coin_ledger_user_ref_idx` ON `coin_ledger` (`user_id`,`reason`,`ref_key`);