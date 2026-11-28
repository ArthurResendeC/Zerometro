import { sql } from "drizzle-orm";
import {
  uniqueIndex,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  activityActors,
  completionTypes,
  gameStatuses,
  objectiveSources,
  playtimeSources,
  seriesKinds,
  sessionSources,
  ttbSources,
} from "../../shared/domain";
import { inviteKinds, userRoles } from "../../shared/auth";
import { achievementSources, achievementUnlockOrigins } from "../../shared/achievements";
import { progressGoals } from "../../shared/completions";
import { type CoinEntryDetails, coinReasons } from "../../shared/economy";
import { itemKinds, itemSources } from "../../shared/items";
import type { CriterionWeights } from "../../shared/rating-criteria";
import { ratingPresets } from "../../shared/rating-criteria";
import { type CriterionNotes, ratingModes, type RatingScores } from "../../shared/ratings";

// Datas/horas como texto ISO 8601 em UTC; datas de calendário (played_on) como YYYY-MM-DD no fuso do usuário.
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const createdAt = () => text("created_at").notNull().default(nowIso);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(nowIso)
    .$onUpdate(() => new Date().toISOString());

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Quem usa a instância: o `owner` (admin, entra também com o ZEROMETRO_TOKEN) e os amigos que
 * ele convidou. Cada um entra com o @apelido e a senha; os dados pessoais têm `user_id`.
 * `email` e `image` são da época da Better Auth (o e-mail dos perfis é `<id>@zerometro.invalid`).
 */
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    role: text("role", { enum: userRoles }).notNull().default("member"),
    /** @apelido do login e do perfil público (minúsculo, único). */
    handle: text("handle"),
    /** Avatar pixel art pré-definido (id em `src/shared/avatars.ts`). */
    avatar: text("avatar"),
    /** Hash da senha (Bun.password, argon2id); null = ainda sem senha (o owner entra pelo token). */
    passwordHash: text("password_hash"),
    /** Vai no cookie: incrementar desloga todos os aparelhos (trocar a senha, "sair de todos"). */
    sessionVersion: integer("session_version").notNull().default(0),
    /** Suspenso pelo admin (ISO UTC): não entra, não aparece no grupo; os dados ficam. */
    disabledAt: text("disabled_at"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_handle_idx")
      .on(t.handle)
      .where(sql`${t.handle} is not null`),
  ],
);

const userId = (column = "user_id") =>
  text(column)
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/** Cache dos metadados do IGDB (compartilhado entre usuários). */
export const games = sqliteTable("games", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  igdbId: integer("igdb_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug"),
  coverImageId: text("cover_image_id"),
  platforms: text("platforms", { mode: "json" }).$type<string[]>().notNull().default([]),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull().default([]),
  themes: text("themes", { mode: "json" }).$type<string[]>().notNull().default([]),
  gameModes: text("game_modes", { mode: "json" }).$type<string[]>().notNull().default([]),
  perspectives: text("perspectives", { mode: "json" }).$type<string[]>().notNull().default([]),
  releaseYear: integer("release_year"),
  ttbMainSec: integer("ttb_main_sec"),
  ttbExtraSec: integer("ttb_extra_sec"),
  ttbCompleteSec: integer("ttb_complete_sec"),
  ttbSource: text("ttb_source", { enum: ttbSources }),
  /** App da Steam (de `external_games` do IGDB): liga a lista de conquistas sozinho. */
  steamAppId: integer("steam_app_id"),
  /** Quando o IGDB foi consultado sobre o app da Steam (null: nunca; vale re-sincronizar). */
  steamCheckedAt: text("steam_checked_at"),
  syncedAt: text("synced_at"),
  /**
   * Versão dos metadados gravados (temas, modos, empresas, séries…). Abaixo de
   * `IGDB_META_VERSION`, o backfill busca o jogo de novo no IGDB.
   */
  metaVersion: integer("meta_version").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Empresas do IGDB (desenvolvedoras e publishers), compartilhadas como o cache `games`. */
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  igdbId: integer("igdb_id").notNull().unique(),
  name: text("name").notNull(),
});

/** Quem desenvolveu e quem publicou cada jogo (a mesma empresa pode ser as duas coisas). */
export const gameCompanies = sqliteTable(
  "game_companies",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    developer: integer("developer", { mode: "boolean" }).notNull().default(false),
    publisher: integer("publisher", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.companyId] }),
    index("game_companies_company_idx").on(t.companyId),
  ],
);

/** Séries (`collections`) e franquias (`franchises`) do IGDB; os ids de cada tipo são separados. */
export const series = sqliteTable(
  "series",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    igdbId: integer("igdb_id").notNull(),
    kind: text("kind", { enum: seriesKinds }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("series_kind_igdb_idx").on(t.kind, t.igdbId)],
);

export const gameSeries = sqliteTable(
  "game_series",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.seriesId] }),
    index("game_series_series_idx").on(t.seriesId),
  ],
);

/** A relação de cada usuário com um jogo (no máximo uma entrada por usuário e jogo). */
export const libraryEntries = sqliteTable(
  "library_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    status: text("status", { enum: gameStatuses }).notNull(),
    /** Plataforma do jogo (de qual console é a versão jogada). */
    platformPlayed: text("platform_played"),
    /** Onde rodou, quando emulado (PC, Android, Steam Deck ou texto livre); null = nativo. */
    emulatedOn: text("emulated_on"),
    /** Meta da barra de progresso; null = a padrão do status. */
    progressGoal: text("progress_goal", { enum: progressGoals }),
    /** Alvo da meta "hours", em minutos (validado no serviço). */
    progressGoalMinutes: integer("progress_goal_minutes"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    /** Cache da nota final da avaliação mais recente (0–10; a fonte é `ratings`). */
    rating: real("rating"),
    notes: text("notes"),
    /** Tempo jogado antes de registrar no Zerômetro: conta no total do jogo, não nas estatísticas. */
    priorMinutes: integer("prior_minutes").notNull().default(0),
    /** De onde vem o total jogado: sessões (+ `priorMinutes`) ou o total da Steam. */
    playtimeSource: text("playtime_source", { enum: playtimeSources })
      .notNull()
      .default("sessions"),
    /** Total na Steam na última sincronização (null: nunca sincronizou ou não está na conta). */
    steamMinutes: integer("steam_minutes"),
    steamSyncedAt: text("steam_synced_at"),
    /**
     * Total da Steam já contado (como "antes" ou em sessões `steam`): a próxima sincronização
     * transforma em sessão só o que passar disso. null: ainda sem base (a próxima só marca).
     */
    steamCountedMinutes: integer("steam_counted_minutes"),
    /** Quando a base foi marcada: as sessões do timer/manuais depois disso são descontadas. */
    steamCountedAt: text("steam_counted_at"),
    /** Compra (comprei × zerei): dia em que comprou ou resgatou (YYYY-MM-DD). */
    acquiredOn: text("acquired_on"),
    /** Preço pago, em centavos de real (0 = de graça; null = não informado). */
    pricePaidCents: integer("price_paid_cents"),
    /** Loja ou serviço (Steam, Nuuvem, eShop, Game Pass…), texto livre. */
    store: text("store"),
    /** Veio de uma assinatura (Game Pass, PS Plus…): fica fora do custo por hora. */
    viaSubscription: integer("via_subscription", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("library_entries_user_game_idx").on(t.userId, t.gameId),
    index("library_entries_user_status_idx").on(t.userId, t.status),
    check("library_entries_rating_range", sql`${t.rating} is null or ${t.rating} between 0 and 10`),
    check("library_entries_prior_minutes_non_negative", sql`${t.priorMinutes} >= 0`),
    check(
      "library_entries_price_non_negative",
      sql`${t.pricePaidCents} is null or ${t.pricePaidCents} >= 0`,
    ),
  ],
);

/** Sessões de jogo: um registro por "joguei X minutos de Y no dia Z". */
export const playSessions = sqliteTable(
  "play_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** Dia (no fuso do usuário) em que a sessão começou. */
    playedOn: text("played_on").notNull(),
    /** Nulo só enquanto o timer está rodando. */
    minutes: integer("minutes"),
    /** Início/fim (ISO UTC) das sessões de timer; nulos em registros manuais. */
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    note: text("note"),
    source: text("source", { enum: sessionSources }).notNull().default("manual"),
    /**
     * UUID gerado no aparelho para sessões registradas offline (fila de sincronização):
     * reenviar o mesmo id devolve a sessão existente em vez de duplicar.
     */
    clientId: text("client_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("play_sessions_user_played_on_idx").on(t.userId, t.playedOn),
    uniqueIndex("play_sessions_user_client_id_idx")
      .on(t.userId, t.clientId)
      .where(sql`${t.clientId} is not null`),
    index("play_sessions_user_game_played_on_idx").on(t.userId, t.gameId, t.playedOn),
    check("play_sessions_minutes_positive", sql`${t.minutes} is null or ${t.minutes} > 0`),
    // Sessão ativa (timer rodando) = início sem fim, e só ela tem minutos nulos.
    check(
      "play_sessions_active_shape",
      sql`(${t.minutes} is null) = (${t.startedAt} is not null and ${t.endedAt} is null)`,
    ),
    // No máximo uma sessão ativa por usuário (índice único parcial).
    uniqueIndex("play_sessions_one_active_idx")
      .on(t.userId)
      .where(sql`${t.startedAt} is not null and ${t.endedAt} is null`),
  ],
);

/**
 * Conclusões de um jogo (história, + extras, 100%), com data. Um jogo pode ter várias (replays).
 * Independe do status: um jogo zerado que voltei a jogar fica "jogando" com conclusão (pós-jogo).
 */
export const completions = sqliteTable(
  "completions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    type: text("type", { enum: completionTypes }).notNull(),
    /** Dia (no fuso do usuário) em que zerou. */
    completedOn: text("completed_on").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("completions_user_game_completed_on_idx").on(t.userId, t.gameId, t.completedOn),
    index("completions_user_completed_on_idx").on(t.userId, t.completedOn),
  ],
);

/**
 * Avaliações guiadas de um jogo: notas 1–7 por critério, nota de coração e a final. Um jogo pode
 * ter várias (uma por playthrough); a atual é a mais recente, e a final dela fica em cache em
 * `library_entries.rating`.
 */
export const ratings = sqliteTable(
  "ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** Playthrough avaliado; apagar a conclusão mantém a avaliação. */
    completionId: integer("completion_id").references(() => completions.id, {
      onDelete: "set null",
    }),
    /** Nota 1–7 por critério; ausente ou null = "Não se aplica". */
    scores: text("scores", { mode: "json" }).$type<RatingScores>().notNull(),
    criterionNotes: text("criterion_notes", { mode: "json" }).$type<CriterionNotes>(),
    /** Snapshot dos pesos usados: mudar os pesos padrão depois não altera a nota. */
    weights: text("weights", { mode: "json" }).$type<CriterionWeights>().notNull(),
    preset: text("preset", { enum: ratingPresets }).notNull(),
    /** Nota de coração, 0–10. */
    enjoyment: real("enjoyment").notNull(),
    /** Ponderada 0–10 (null com poucos critérios aplicáveis). */
    weighted: real("weighted"),
    final: real("final").notNull(),
    mode: text("mode", { enum: ratingModes }).notNull(),
    review: text("review"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ratings_user_game_created_idx").on(t.userId, t.gameId, t.createdAt),
    check("ratings_enjoyment_range", sql`${t.enjoyment} between 0 and 10`),
    check("ratings_final_range", sql`${t.final} between 0 and 10`),
  ],
);

/**
 * Objetivos de um jogo: checkbox (alvo 1) ou contador (ex.: 900 sementes Korok).
 * Hoje só manuais; `source`/`external_id`/`icon_url`/`rarity` são para conquistas da Steam/RA.
 */
export const objectives = sqliteTable(
  "objectives",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    source: text("source", { enum: objectiveSources }).notNull().default("manual"),
    /** Id na fonte externa (nulo nos manuais). */
    externalId: text("external_id"),
    title: text("title").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    /** % global de quem desbloqueou (fontes externas). */
    rarity: real("rarity"),
    target: integer("target").notNull().default(1),
    progress: integer("progress").notNull().default(0),
    /** Quando o progresso chegou ao alvo (ISO UTC); nulo enquanto não chega. */
    unlockedAt: text("unlocked_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("objectives_user_game_idx").on(t.userId, t.gameId, t.sortOrder),
    uniqueIndex("objectives_external_idx")
      .on(t.userId, t.gameId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check("objectives_target_positive", sql`${t.target} >= 1`),
    check("objectives_progress_range", sql`${t.progress} between 0 and ${t.target}`),
  ],
);

/**
 * Lista de conquistas de um jogo numa fonte (Steam ou RetroAchievements), compartilhada entre
 * usuários como o cache `games`. Qual jogo segue qual lista fica em `user_achievement_sets`
 * (a mesma lista pode servir a mais de um jogo, ex.: a versão da Steam de um remaster).
 */
export const achievementSets = sqliteTable(
  "achievement_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: achievementSources }).notNull(),
    /** appid na Steam; id do jogo no RA. */
    externalId: text("external_id").notNull(),
    /** Nome do jogo na fonte (null se a fonte não deu um confiável). */
    title: text("title"),
    /** Console no RA. */
    platform: text("platform"),
    /** Quando a lista foi buscada na fonte (ISO UTC); vence depois de 30 dias. */
    fetchedAt: text("fetched_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("achievement_sets_source_external_idx").on(t.source, t.externalId)],
);

/** Uma conquista de uma lista (só leitura: vem da fonte). */
export const achievements = sqliteTable(
  "achievements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    setId: integer("set_id")
      .notNull()
      .references(() => achievementSets.id, { onDelete: "cascade" }),
    /** apiname na Steam; id da conquista no RA. */
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    iconLockedUrl: text("icon_locked_url"),
    /** % global de quem desbloqueou. */
    rarity: real("rarity"),
    /** Pontos (só RA). */
    points: integer("points"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Sumiu da fonte numa atualização: fica guardada (com os desbloqueios), fora das contas. */
    removedAt: text("removed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("achievements_set_external_idx").on(t.setId, t.externalId),
    index("achievements_set_order_idx").on(t.setId, t.sortOrder),
  ],
);

/** Quais listas o usuário segue em cada jogo (pode ser mais de uma, ex.: Steam + RA). */
export const userAchievementSets = sqliteTable(
  "user_achievement_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    setId: integer("set_id")
      .notNull()
      .references(() => achievementSets.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_achievement_sets_idx").on(t.userId, t.gameId, t.setId)],
);

/** Conquistas que o usuário desbloqueou. */
export const achievementUnlocks = sqliteTable(
  "achievement_unlocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    achievementId: integer("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    /** Quando desbloqueou (ISO UTC): agora, a data informada ou a da fonte (sync). */
    unlockedAt: text("unlocked_at").notNull(),
    origin: text("origin", { enum: achievementUnlockOrigins }).notNull().default("manual"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("achievement_unlocks_user_achievement_idx").on(t.userId, t.achievementId)],
);

/** Auditoria: o que mudou e por onde (web, MCP ou job). */
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    actor: text("actor", { enum: activityActors }).notNull(),
    action: text("action").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_log_created_at_idx").on(t.createdAt)],
);

/**
 * Itens de personalização que o usuário tem (temas, pacotes de som). O que é de graça (o tema
 * base e o pacote dele) não tem linha. Um item por usuário: ganhar de novo não duplica.
 */
export const userItems = sqliteTable(
  "user_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    kind: text("kind", { enum: itemKinds }).notNull(),
    itemId: text("item_id").notNull(),
    source: text("source", { enum: itemSources }).notNull(),
    /** Quando ganhou/comprou (ISO UTC). */
    acquiredAt: text("acquired_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_items_user_kind_item_idx").on(t.userId, t.kind, t.itemId)],
);

/**
 * Livro-razão das moedas: só inserção. O saldo é a soma. Os ganhos derivados (horas, conquistas)
 * são recalculados a partir dos dados e a diferença entra como ajuste (`ref_key` identifica o que
 * originou: `day:2026-11-27`, `achievement:123`), então editar uma sessão nunca apaga histórico.
 */
export const coinLedger = sqliteTable(
  "coin_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: userId(),
    amount: integer("amount").notNull(),
    reason: text("reason", { enum: coinReasons }).notNull(),
    refKey: text("ref_key").notNull(),
    details: text("details", { mode: "json" }).$type<CoinEntryDetails>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("coin_ledger_user_created_idx").on(t.userId, t.createdAt),
    index("coin_ledger_user_ref_idx").on(t.userId, t.reason, t.refKey),
    check("coin_ledger_amount_not_zero", sql`${t.amount} <> 0`),
  ],
);

/** Chave-valor para estado interno (token do IGDB, ajustes por usuário em `settings:<userId>`). */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

/**
 * Links de uso único que o admin gera: `signup` cria um perfil novo; `reset` redefine a senha de
 * `target_user_id`. Só o hash do código fica no banco.
 */
export const invites = sqliteTable(
  "invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: inviteKinds }).notNull().default("signup"),
    /** sha256 (hex) do código do link. */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: userId("created_by"),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "cascade" }),
    /** Para quem é ("pro João"), só para o admin se achar na lista. */
    note: text("note"),
    expiresAt: text("expires_at").notNull(),
    usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
    usedAt: text("used_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("invites_reset_has_target", sql`(${t.kind} = 'reset') = (${t.targetUserId} is not null)`),
  ],
);

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type NewLibraryEntry = typeof libraryEntries.$inferInsert;
export type PlaySession = typeof playSessions.$inferSelect;
export type NewPlaySession = typeof playSessions.$inferInsert;
export type Completion = typeof completions.$inferSelect;
export type Objective = typeof objectives.$inferSelect;
export type UserItem = typeof userItems.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type AchievementSet = typeof achievementSets.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type User = typeof user.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
