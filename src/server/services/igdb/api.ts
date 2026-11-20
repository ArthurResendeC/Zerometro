import type { FeedGame, FeedKey, ReleasePrecision } from "../../../shared/feeds";
import type {
  AgeRating,
  AgeRatingOrg,
  GameLink,
  GameLinkKind,
  GameReleaseStatus,
  GameVideo,
  IgdbGamePage,
  LanguageSupport,
  PlatformRelease,
  RelatedGame,
} from "../../../shared/game-page";
import { gameLinkKinds } from "../../../shared/game-page";
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

/** Jogo citado dentro de outro (parecidos, série, expansões…). */
interface RawRef {
  id: number;
  name?: string;
  slug?: string;
  cover?: { image_id: string };
  first_release_date?: number;
  game_type?: number;
  version_parent?: number;
}

interface RawGamePage extends RawFeedGame {
  summary?: string;
  storyline?: string;
  rating?: number;
  rating_count?: number;
  game_status?: number;
  involved_companies?: { company?: { name: string }; developer?: boolean; publisher?: boolean }[];
  themes?: { name: string }[];
  game_modes?: { name: string }[];
  player_perspectives?: { name: string }[];
  game_engines?: { name: string }[];
  release_dates?: {
    date?: number;
    date_format?: number;
    release_region?: number;
    /** `release_date_statuses`: 6 = lançamento completo; 34 = acesso antecipado por edição… */
    status?: number;
    platform?: { name: string; abbreviation?: string };
  }[];
  artworks?: {
    image_id: string;
    width?: number;
    height?: number;
    artwork_type?: number;
    alpha_channel?: boolean;
  }[];
  screenshots?: { image_id: string }[];
  videos?: { video_id: string; name?: string }[];
  websites?: { url: string; type?: number }[];
  language_supports?: { language?: { name: string }; language_support_type?: number }[];
  age_ratings?: { organization?: number; rating_category?: { rating?: string } }[];
  parent_game?: RawRef;
  expansions?: RawRef[];
  standalone_expansions?: RawRef[];
  dlcs?: RawRef[];
  remakes?: RawRef[];
  remasters?: RawRef[];
  similar_games?: RawRef[];
  collections?: { games?: RawRef[] }[];
  franchises?: { games?: RawRef[] }[];
}

interface RawPopularity {
  game_id: number;
}

interface RawTimeToBeat {
  game_id: number;
  hastily?: number;
  normally?: number;
  completely?: number;
  count?: number;
}

// Página do jogo: uma query em /games traz quase tudo (os campos aninhados vêm junto) e o
// tempo para zerar vem numa segunda, em /game_time_to_beats.
const REF_SUBFIELDS = ["name", "slug", "cover.image_id", "first_release_date"];
const refFields = (prefix: string, extra: string[] = []) =>
  [...REF_SUBFIELDS, ...extra].map((f) => `${prefix}.${f}`);
const SERIES_SUBFIELDS = ["game_type", "version_parent"];
const PAGE_FIELDS = [
  FEED_FIELDS,
  "summary",
  "storyline",
  "rating",
  "rating_count",
  "game_status",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "themes.name",
  "game_modes.name",
  "player_perspectives.name",
  "game_engines.name",
  "release_dates.release_region",
  "release_dates.status",
  "release_dates.platform.name",
  "release_dates.platform.abbreviation",
  "artworks.image_id",
  "artworks.width",
  "artworks.height",
  "artworks.artwork_type",
  "artworks.alpha_channel",
  "screenshots.image_id",
  "videos.video_id",
  "videos.name",
  "websites.url",
  "websites.type",
  "language_supports.language.name",
  "language_supports.language_support_type",
  "age_ratings.organization",
  "age_ratings.rating_category.rating",
  ...refFields("parent_game"),
  ...refFields("expansions"),
  ...refFields("standalone_expansions"),
  ...refFields("dlcs"),
  ...refFields("remakes"),
  ...refFields("remasters"),
  ...refFields("similar_games"),
  ...refFields("collections.games", SERIES_SUBFIELDS),
  ...refFields("franchises.games", SERIES_SUBFIELDS),
].join(", ");

const MAX_SCREENSHOTS = 12;
const MAX_VIDEOS = 8;
const MAX_SERIES = 20;
/** Artwork só vira banner se for bem mais largo que alto, sem ser uma faixa estreita. */
const MIN_HERO_RATIO = 1.5;
const MAX_HERO_RATIO = 4;
/**
 * `artwork_types` que servem de banner, do melhor para o pior: 2 arte principal sem logo,
 * 1 artwork (e 15, artwork antigo), 3 arte principal com logo, 4 arte conceitual. Os outros
 * (logotipos, ícones, capas alternativas, infográficos) ficam de fora. Sem tipo (cadastros
 * antigos) conta como artwork comum.
 */
const HERO_ARTWORK_PRIORITY: Record<number, number> = { 2: 0, 1: 1, 15: 1, 3: 2, 4: 3 };
const UNTYPED_ARTWORK_PRIORITY = 1;
/** Jogos "principais" numa série (jogo, remake, remaster), como nas listas da home. */
const MAIN_GAME_TYPES = new Set([0, 8, 9]);

/** `game_statuses` do IGDB (0 = lançado, sem selo). */
const RELEASE_STATUS: Record<number, GameReleaseStatus> = {
  2: "alpha",
  3: "beta",
  4: "early_access",
  5: "offline",
  6: "cancelled",
  7: "rumored",
  8: "delisted",
};

/** `website_types` do IGDB. */
const WEBSITE_KINDS: Record<number, GameLinkKind> = {
  1: "official",
  2: "wiki",
  3: "wikipedia",
  4: "facebook",
  5: "twitter",
  6: "twitch",
  8: "instagram",
  9: "youtube",
  10: "app_store",
  11: "app_store",
  12: "google_play",
  13: "steam",
  14: "reddit",
  15: "itch",
  16: "epic",
  17: "gog",
  18: "discord",
  19: "bluesky",
  22: "xbox",
  23: "playstation",
  24: "nintendo",
  26: "gamejolt",
};

/** `age_rating_organizations` do IGDB, na ordem de preferência. */
const AGE_RATING_ORGS: [number, AgeRatingOrg][] = [
  [6, "classind"],
  [2, "pegi"],
  [1, "esrb"],
];

/** `release_date_regions`: 10 Brasil, 8 mundial. Quanto menor, mais preferida. */
const REGION_PRIORITY: Record<number, number> = { 10: 0, 8: 1 };
const OTHER_REGION = 2;
/** `release_date_statuses` 6: lançamento completo (o normal; sem status também conta). */
const FULL_RELEASE = 6;

/** `language_support_types`: 1 áudio, 2 legendas, 3 interface. */
const LANGUAGE_SUPPORT: Record<number, "audio" | "subtitles" | "interface"> = {
  1: "audio",
  2: "subtitles",
  3: "interface",
};

export interface IgdbApi {
  /** Busca jogos por nome (sem edições, DLCs e packs), mais populares primeiro. */
  searchGames(term: string, limit?: number): Promise<IgdbGameSummary[]>;
  /** Detalhes + tempo para zerar. Edições sem tempo próprio herdam o do jogo base. */
  getGame(igdbId: number): Promise<IgdbGameDetails | null>;
  /** Tudo o que a página do jogo mostra (2 requests). null se o jogo não existir. */
  getGamePage(igdbId: number): Promise<IgdbGamePage | null>;
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

      const ttb = await fetchTimeToBeat(raw);
      return { ...toSummary(raw), timeToBeat: ttb ? toTimeToBeat(ttb) : null };
    },

    async getGamePage(igdbId) {
      const [raw] = await client.query<RawGamePage[]>(
        "games",
        `fields ${PAGE_FIELDS}; where id = ${toInt(igdbId)}; limit 1;`,
      );
      if (!raw) return null;

      const ttb = await fetchTimeToBeat(raw);
      return toGamePage(raw, ttb);
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

  /** O tempo do próprio jogo; se não houver, o do jogo base (edições). */
  async function fetchTimeToBeat(raw: RawGame): Promise<RawTimeToBeat | null> {
    const ids = raw.version_parent ? [raw.id, raw.version_parent] : [raw.id];
    const ttbs = await client.query<RawTimeToBeat[]>(
      "game_time_to_beats",
      `fields game_id, hastily, normally, completely, count; where game_id = (${ids.join(",")});`,
    );
    return (
      ttbs.find((t) => t.game_id === raw.id) ??
      ttbs.find((t) => t.game_id === raw.version_parent) ??
      null
    );
  }

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

function toGamePage(raw: RawGamePage, ttb: RawTimeToBeat | null): IgdbGamePage {
  const companies = raw.involved_companies ?? [];
  const companyNames = (role: "developer" | "publisher") =>
    unique(companies.filter((c) => c[role]).flatMap((c) => c.company?.name ?? []));
  const screenshotIds = (raw.screenshots ?? []).map((s) => s.image_id);

  return {
    ...toFeedGame(raw),
    summary: raw.summary?.trim() || null,
    storyline: raw.storyline?.trim() || null,
    userRating: raw.rating === undefined ? null : Math.round(raw.rating),
    userRatingCount: raw.rating_count ?? 0,
    status: raw.game_status === undefined ? null : (RELEASE_STATUS[raw.game_status] ?? null),
    developers: companyNames("developer"),
    publishers: companyNames("publisher"),
    themes: names(raw.themes),
    gameModes: names(raw.game_modes),
    perspectives: names(raw.player_perspectives),
    engines: names(raw.game_engines),
    releases: toReleases(raw.release_dates ?? []),
    heroImageId: pickHero(raw.artworks ?? []) ?? screenshotIds[0] ?? null,
    screenshotIds: screenshotIds.slice(0, MAX_SCREENSHOTS),
    videos: toVideos(raw.videos ?? []),
    links: toLinks(raw.websites ?? []),
    languages: toLanguages(raw.language_supports ?? []),
    ageRating: toAgeRating(raw.age_ratings ?? []),
    timeToBeat: ttb ? toTimeToBeat(ttb) : null,
    timeToBeatCount: ttb?.count ?? 0,
    parentGame: toRelatedList(raw.parent_game ? [raw.parent_game] : [])[0] ?? null,
    related: {
      expansions: toRelatedList([...(raw.expansions ?? []), ...(raw.standalone_expansions ?? [])]),
      dlcs: toRelatedList(raw.dlcs ?? []),
      remakes: toRelatedList([...(raw.remakes ?? []), ...(raw.remasters ?? [])]),
      series: toSeries(raw),
      similar: toRelatedList(raw.similar_games ?? []),
    },
  };
}

/**
 * O melhor artwork paisagem pelo tipo (arte principal sem logo primeiro); empate → o mais
 * largo. Logotipos e imagens com transparência ficam de fora: no banner viram um fundo preto.
 */
function pickHero(artworks: NonNullable<RawGamePage["artworks"]>): string | null {
  let best: { id: string; priority: number; width: number } | null = null;
  for (const a of artworks) {
    const { image_id: id, width = 0, height = 0 } = a;
    const priority =
      a.artwork_type === undefined
        ? UNTYPED_ARTWORK_PRIORITY
        : HERO_ARTWORK_PRIORITY[a.artwork_type];
    const ratio = height > 0 ? width / height : 0;
    if (priority === undefined || a.alpha_channel) continue;
    if (ratio < MIN_HERO_RATIO || ratio > MAX_HERO_RATIO) continue;
    if (!best || priority < best.priority || (priority === best.priority && width > best.width)) {
      best = { id, priority, width };
    }
  }
  return best?.id ?? null;
}

/**
 * Uma data por plataforma, agrupando as plataformas que lançaram no mesmo dia. Preferência:
 * lançamento completo (acesso antecipado, beta etc. só se não houver), depois Brasil > mundial
 * > outra região; empate → a mais cedo. Datas "a definir" ficam de fora.
 */
function toReleases(dates: NonNullable<RawGamePage["release_dates"]>): PlatformRelease[] {
  const byPlatform = new Map<string, { date: number; precision: ReleasePrecision; rank: number }>();
  for (const d of dates) {
    if (d.date === undefined || !d.platform) continue;
    const precision = d.date_format === undefined ? "day" : RELEASE_PRECISION[d.date_format];
    if (!precision) continue;
    const platform = d.platform.abbreviation ?? d.platform.name;
    const partial = d.status !== undefined && d.status !== FULL_RELEASE;
    const region = REGION_PRIORITY[d.release_region ?? -1] ?? OTHER_REGION;
    const rank = (partial ? OTHER_REGION + 1 : 0) + region;
    const current = byPlatform.get(platform);
    if (!current || rank < current.rank || (rank === current.rank && d.date < current.date)) {
      byPlatform.set(platform, { date: d.date, precision, rank });
    }
  }

  const sorted = [...byPlatform].toSorted(([, a], [, b]) => a.date - b.date);
  const groups = new Map<string, PlatformRelease>();
  for (const [platform, { date, precision }] of sorted) {
    const key = `${date}:${precision}`;
    const group = groups.get(key);
    if (group) group.platforms.push(platform);
    else groups.set(key, { date: toIsoDate(date), precision, platforms: [platform] });
  }
  return [...groups.values()];
}

/** Trailers primeiro (o de lançamento antes), mantendo a ordem do IGDB no resto. */
function toVideos(videos: NonNullable<RawGamePage["videos"]>): GameVideo[] {
  return videos
    .map((v) => ({ youtubeId: v.video_id, name: v.name?.trim() || "Vídeo" }))
    .toSorted((a, b) => videoRank(a.name) - videoRank(b.name))
    .slice(0, MAX_VIDEOS);
}

/** Um link por tipo (o primeiro), na ordem de `gameLinkKinds`; tipos desconhecidos saem. */
function toLinks(websites: NonNullable<RawGamePage["websites"]>): GameLink[] {
  const byKind = new Map<GameLinkKind, string>();
  for (const w of websites) {
    const kind = w.type === undefined ? undefined : WEBSITE_KINDS[w.type];
    if (kind && !byKind.has(kind)) byKind.set(kind, w.url);
  }
  return gameLinkKinds.flatMap((kind) => {
    const url = byKind.get(kind);
    return url ? [{ kind, url }] : [];
  });
}

/** O IGDB manda uma linha por idioma e tipo de suporte; junta por idioma, em ordem alfabética. */
function toLanguages(supports: NonNullable<RawGamePage["language_supports"]>): LanguageSupport[] {
  const byName = new Map<string, LanguageSupport>();
  for (const s of supports) {
    const name = s.language?.name;
    const type =
      s.language_support_type === undefined ? undefined : LANGUAGE_SUPPORT[s.language_support_type];
    if (!name || !type) continue;
    const entry = byName.get(name) ?? { name, audio: false, subtitles: false, interface: false };
    entry[type] = true;
    byName.set(name, entry);
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

function toAgeRating(ratings: NonNullable<RawGamePage["age_ratings"]>): AgeRating | null {
  for (const [orgId, org] of AGE_RATING_ORGS) {
    const rating = ratings.find((r) => r.organization === orgId)?.rating_category?.rating;
    if (rating) return { org, rating };
  }
  return null;
}

/** Jogos principais da série e da franquia (sem o próprio jogo, edições e DLCs), por data. */
function toSeries(raw: RawGamePage): RelatedGame[] {
  const games = [...(raw.collections ?? []), ...(raw.franchises ?? [])].flatMap(
    (c) => c.games ?? [],
  );
  const main = games.filter(
    (g) =>
      g.id !== raw.id &&
      g.version_parent === undefined &&
      g.game_type !== undefined &&
      MAIN_GAME_TYPES.has(g.game_type),
  );
  const byDate = main.toSorted(
    (a, b) => (a.first_release_date ?? Infinity) - (b.first_release_date ?? Infinity),
  );
  return toRelatedList(byDate).slice(0, MAX_SERIES);
}

/** Sem repetir e sem os que vieram sem nome. */
function toRelatedList(refs: RawRef[]): RelatedGame[] {
  const seen = new Set<number>();
  return refs.flatMap((ref) => {
    if (!ref.name || seen.has(ref.id)) return [];
    seen.add(ref.id);
    return [
      {
        igdbId: ref.id,
        name: ref.name,
        slug: ref.slug ?? null,
        coverImageId: ref.cover?.image_id ?? null,
        releaseYear: ref.first_release_date
          ? toDate(ref.first_release_date).getUTCFullYear()
          : null,
      },
    ];
  });
}

function videoRank(name: string): number {
  if (/launch trailer/i.test(name)) return 0;
  return /trailer/i.test(name) ? 1 : 2;
}

function names(list?: { name: string }[]): string[] {
  return (list ?? []).map((x) => x.name);
}

function toDate(sec: number): Date {
  return new Date(sec * 1000);
}

function toIsoDate(sec: number): string {
  return toDate(sec).toISOString().slice(0, 10);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
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
