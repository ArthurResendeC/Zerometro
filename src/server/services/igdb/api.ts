import type { FeedGame, FeedKey, ReleasePrecision } from "../../../shared/feeds";
import type { IgdbGameDetails, IgdbGameSummary, TimeToBeat } from "../../../shared/igdb";
import type { IgdbClient } from "./client";

// Operações de alto nível sobre o IGDB, já convertidas para os tipos do app.

const GAME_FIELDS = [
  "name",
  "slug",
  "cover.image_id",
  "platforms.name",
  "platforms.abbreviation",
  "genres.name",
  "first_release_date",
  "game_type",
  "version_parent",
  "total_rating_count",
].join(", ");

/** Tipos do IGDB que fazem sentido jogar e registrar tempo (sem DLC, bundle, mod, update…). */
const GAME_TYPE_LABELS: Record<number, string> = {
  0: "Jogo",
  2: "Expansão",
  4: "Expansão independente",
  6: "Episódio",
  8: "Remake",
  9: "Remaster",
  10: "Versão expandida",
  11: "Port",
};
const PLAYABLE_GAME_TYPES = Object.keys(GAME_TYPE_LABELS).join(",");
/** Quantos resultados pedir ao IGDB antes de reordenar por popularidade. */
const SEARCH_CANDIDATES = 20;

// Listas da tela inicial. Valores calibrados contra o IGDB real em nov/2026: com 90 dias e
// 5 notas da crítica, "bem avaliados" voltava só 3 jogos.
const FEED_SIZE = 20;
const DAY_SEC = 86_400;
const TOP_RATED_WINDOW_DAYS = 120;
const TOP_RATED_MIN_REVIEWS = 3;
/**
 * "Em alta" = mais "quero jogar" no IGDB entre os lançados no último ano. As visitas (tipo 1)
 * eram dominadas por indies obscuros e jogos antigos; os não lançados já estão em "próximos".
 */
const TRENDING_WINDOW_DAYS = 365;
const TRENDING_CANDIDATES = 200;
/** `popularity_types` 2 = "Want to Play" no IGDB. */
const POPULARITY_WANT_TO_PLAY = 2;
/** Nas listas, só jogos "principais" (jogo, remake, remaster), sem versões expandidas e ports. */
const FEED_FILTER = "game_type = (0,8,9) & version_parent = null & cover != null";
const FEED_FIELDS = [
  GAME_FIELDS,
  "aggregated_rating",
  "aggregated_rating_count",
  "hypes",
  "release_dates.date",
  "release_dates.date_format",
].join(", ");
/** `date_format` do IGDB: 0 dia, 1 mês, 2 ano, 3–6 trimestre, 7 a definir. */
const RELEASE_PRECISION: Record<number, ReleasePrecision> = {
  0: "day",
  1: "month",
  2: "year",
  3: "quarter",
  4: "quarter",
  5: "quarter",
  6: "quarter",
};

interface RawGame {
  id: number;
  name: string;
  slug?: string;
  cover?: { image_id: string };
  platforms?: { name: string; abbreviation?: string }[];
  genres?: { name: string }[];
  first_release_date?: number;
  game_type?: number;
  version_parent?: number;
  total_rating_count?: number;
}

interface RawFeedGame extends RawGame {
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  hypes?: number;
  release_dates?: { date?: number; date_format?: number }[];
}

interface RawPopularity {
  game_id: number;
}

interface RawTimeToBeat {
  game_id: number;
  hastily?: number;
  normally?: number;
  completely?: number;
}

export interface IgdbApi {
  /** Busca jogos por nome (sem edições, DLCs e packs), mais populares primeiro. */
  searchGames(term: string, limit?: number): Promise<IgdbGameSummary[]>;
  /** Detalhes + tempo para zerar. Edições sem tempo próprio herdam o do jogo base. */
  getGame(igdbId: number): Promise<IgdbGameDetails | null>;
  /** Uma das listas da tela inicial, já ordenada. */
  getFeed(key: FeedKey, now: Date): Promise<FeedGame[]>;
}

export function createIgdbApi(client: IgdbClient): IgdbApi {
  return {
    async searchGames(term, limit = 10) {
      // A busca do IGDB não ordena por popularidade (fan games e ports aparecem antes do
      // original). Pegamos mais candidatos, ordenamos por número de avaliações e só então
      // cortamos. sort é estável, então empates mantêm a relevância da busca.
      const raw = await client.query<RawGame[]>(
        "games",
        `search "${escapeApicalypseString(term)}"; fields ${GAME_FIELDS}; ` +
          `where version_parent = null & game_type = (${PLAYABLE_GAME_TYPES}); ` +
          `limit ${Math.max(SEARCH_CANDIDATES, toInt(limit))};`,
      );
      return raw
        .toSorted((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0))
        .slice(0, limit)
        .map(toSummary);
    },

    async getGame(igdbId) {
      const [raw] = await client.query<RawGame[]>(
        "games",
        `fields ${GAME_FIELDS}; where id = ${toInt(igdbId)}; limit 1;`,
      );
      if (!raw) return null;

      const ids = raw.version_parent ? [raw.id, raw.version_parent] : [raw.id];
      const ttbs = await client.query<RawTimeToBeat[]>(
        "game_time_to_beats",
        `fields game_id, hastily, normally, completely; where game_id = (${ids.join(",")});`,
      );
      const ttb =
        ttbs.find((t) => t.game_id === raw.id) ??
        ttbs.find((t) => t.game_id === raw.version_parent);

      return { ...toSummary(raw), timeToBeat: ttb ? toTimeToBeat(ttb) : null };
    },

    async getFeed(key, now) {
      const nowSec = Math.floor(now.getTime() / 1000);
      switch (key) {
        case "top_rated":
          return queryFeed(
            `where first_release_date > ${nowSec - TOP_RATED_WINDOW_DAYS * DAY_SEC} ` +
              `& first_release_date <= ${nowSec} ` +
              `& aggregated_rating_count >= ${TOP_RATED_MIN_REVIEWS} & ${FEED_FILTER}; ` +
              `sort aggregated_rating desc;`,
          );
        case "upcoming":
          return queryFeed(
            `where first_release_date > ${nowSec} & hypes > 0 & ${FEED_FILTER}; sort hypes desc;`,
          );
        case "trending": {
          const popular = await client.query<RawPopularity[]>(
            "popularity_primitives",
            `fields game_id; where popularity_type = ${POPULARITY_WANT_TO_PLAY}; ` +
              `sort value desc; limit ${TRENDING_CANDIDATES};`,
          );
          const ids = [...new Set(popular.map((p) => toInt(p.game_id)))];
          if (ids.length === 0) return [];
          const games = await queryFeed(
            `where id = (${ids.join(",")}) ` +
              `& first_release_date > ${nowSec - TRENDING_WINDOW_DAYS * DAY_SEC} ` +
              `& first_release_date <= ${nowSec} & ${FEED_FILTER};`,
            TRENDING_CANDIDATES,
          );
          // O IGDB não devolve na ordem dos ids: reordena pela popularidade.
          const byId = new Map(games.map((g) => [g.igdbId, g]));
          return ids.flatMap((id) => byId.get(id) ?? []).slice(0, FEED_SIZE);
        }
      }
    },
  };

  async function queryFeed(where: string, limit = FEED_SIZE): Promise<FeedGame[]> {
    const raw = await client.query<RawFeedGame[]>(
      "games",
      `fields ${FEED_FIELDS}; ${where} limit ${limit};`,
    );
    return raw.map(toFeedGame);
  }
}

function toSummary(raw: RawGame): IgdbGameSummary {
  return {
    igdbId: raw.id,
    name: raw.name,
    slug: raw.slug ?? null,
    coverImageId: raw.cover?.image_id ?? null,
    platforms: (raw.platforms ?? []).map((p) => p.abbreviation ?? p.name),
    genres: (raw.genres ?? []).map((g) => g.name),
    releaseYear: raw.first_release_date
      ? new Date(raw.first_release_date * 1000).getUTCFullYear()
      : null,
    gameType: raw.game_type === undefined ? null : (GAME_TYPE_LABELS[raw.game_type] ?? null),
  };
}

function toFeedGame(raw: RawFeedGame): FeedGame {
  const date = raw.first_release_date;
  // A precisão vem da data de lançamento (por plataforma) que originou a first_release_date.
  const format = raw.release_dates?.find((r) => r.date === date)?.date_format;
  return {
    ...toSummary(raw),
    criticRating: raw.aggregated_rating === undefined ? null : Math.round(raw.aggregated_rating),
    criticRatingCount: raw.aggregated_rating_count ?? 0,
    hypes: raw.hypes ?? 0,
    releaseDate: date === undefined ? null : new Date(date * 1000).toISOString().slice(0, 10),
    releasePrecision:
      date === undefined
        ? null
        : format === undefined
          ? "day"
          : (RELEASE_PRECISION[format] ?? null),
  };
}

function toTimeToBeat(raw: RawTimeToBeat): TimeToBeat {
  return {
    mainSec: raw.hastily ?? null,
    extraSec: raw.normally ?? null,
    completeSec: raw.completely ?? null,
  };
}

function escapeApicalypseString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Os valores entram direto na query; garante que são inteiros. */
function toInt(value: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Esperava um inteiro, recebi ${value}`);
  return value;
}
