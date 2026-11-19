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
  };
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
