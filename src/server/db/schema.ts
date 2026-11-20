import { sql } from "drizzle-orm";
import {
  uniqueIndex,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  activityActors,
  completionTypes,
  gameStatuses,
  objectiveSources,
  sessionSources,
  ttbSources,
} from "../../shared/domain";

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
 * O dono dos dados. Cada instância é de uma pessoa só (entra com o ZEROMETRO_TOKEN), então há
 * uma linha, `owner`; a tabela fica como alvo das FKs de `user_id` (ver OWNER_ID em auth.ts).
 * Os campos são os da época da Better Auth, que a migration 0007 aposentou.
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs)
    .$onUpdate(() => new Date()),
});

const userId = () =>
  text("user_id")
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
  releaseYear: integer("release_year"),
  ttbMainSec: integer("ttb_main_sec"),
  ttbExtraSec: integer("ttb_extra_sec"),
  ttbCompleteSec: integer("ttb_complete_sec"),
  ttbSource: text("ttb_source", { enum: ttbSources }),
  syncedAt: text("synced_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    platformPlayed: text("platform_played"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    rating: integer("rating"),
    notes: text("notes"),
    /** Tempo jogado antes de registrar no Zerômetro: conta no total do jogo, não nas estatísticas. */
    priorMinutes: integer("prior_minutes").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("library_entries_user_game_idx").on(t.userId, t.gameId),
    index("library_entries_user_status_idx").on(t.userId, t.status),
    check("library_entries_rating_range", sql`${t.rating} is null or ${t.rating} between 1 and 10`),
    check("library_entries_prior_minutes_non_negative", sql`${t.priorMinutes} >= 0`),
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

/** Chave-valor para estado interno (token do IGDB, ajustes por usuário em `settings:<userId>`). */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type NewLibraryEntry = typeof libraryEntries.$inferInsert;
export type PlaySession = typeof playSessions.$inferSelect;
export type NewPlaySession = typeof playSessions.$inferInsert;
export type Completion = typeof completions.$inferSelect;
export type Objective = typeof objectives.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
