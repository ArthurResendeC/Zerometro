-- Sai a Better Auth (login com Google, convidados e o OAuth do MCP): cada instância é de uma
-- pessoa só, que entra com o ZEROMETRO_TOKEN. As tabelas dela vão embora (filhas antes das mães).
DROP TABLE `oauth_access_token`;--> statement-breakpoint
DROP TABLE `oauth_refresh_token`;--> statement-breakpoint
DROP TABLE `oauth_consent`;--> statement-breakpoint
DROP TABLE `oauth_client_resource`;--> statement-breakpoint
DROP TABLE `oauth_client_assertion`;--> statement-breakpoint
DROP TABLE `oauth_resource`;--> statement-breakpoint
DROP TABLE `oauth_client`;--> statement-breakpoint
DROP TABLE `jwks`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
DROP TABLE `verification`;--> statement-breakpoint
-- Um dono só, `owner` (OWNER_ID em auth.ts). Os dados passam a ser dele: os do usuário com mais
-- sessões (depois mais jogos na biblioteca, depois o mais antigo); os demais usuários saem, com
-- os dados deles (cascade).
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`)
VALUES ('owner', 'Dono', 'owner@zerometro.invalid', 0)
ON CONFLICT (`id`) DO NOTHING;--> statement-breakpoint
CREATE TEMP TABLE `_dono_anterior` AS
SELECT `id` FROM `user` WHERE `id` <> 'owner'
ORDER BY
  (SELECT count(*) FROM `play_sessions` WHERE `play_sessions`.`user_id` = `user`.`id`) DESC,
  (SELECT count(*) FROM `library_entries` WHERE `library_entries`.`user_id` = `user`.`id`) DESC,
  `created_at`
LIMIT 1;--> statement-breakpoint
DELETE FROM `user` WHERE `id` <> 'owner' AND `id` NOT IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
DELETE FROM `kv`
WHERE `key` LIKE 'settings:%'
  AND `key` <> 'settings:owner'
  AND substr(`key`, 10) NOT IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `library_entries` SET `user_id` = 'owner' WHERE `user_id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `play_sessions` SET `user_id` = 'owner' WHERE `user_id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `completions` SET `user_id` = 'owner' WHERE `user_id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `objectives` SET `user_id` = 'owner' WHERE `user_id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `activity_log` SET `user_id` = 'owner' WHERE `user_id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
UPDATE `kv` SET `key` = 'settings:owner'
WHERE `key` IN (SELECT 'settings:' || `id` FROM `_dono_anterior`)
  AND NOT EXISTS (SELECT 1 FROM `kv` WHERE `key` = 'settings:owner');--> statement-breakpoint
DELETE FROM `user` WHERE `id` IN (SELECT `id` FROM `_dono_anterior`);--> statement-breakpoint
DROP TABLE `_dono_anterior`;
