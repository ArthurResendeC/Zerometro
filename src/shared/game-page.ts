import type { FeedGame, ReleasePrecision } from "./feeds";
import type { TimeToBeat } from "./igdb";

// Dados do IGDB para a página de um jogo (aba "Sobre"), na biblioteca ou não.
// Nomes de gêneros, temas, modos e perspectivas vêm em inglês, como no IGDB; a tradução é
// só na exibição (`genres.ts` e `game-labels.ts`). Resumo e história só existem em inglês.

/** Jogo citado na página (parecidos, série, expansões…), com o mínimo para um card. */
export interface RelatedGame {
  igdbId: number;
  name: string;
  slug: string | null;
  coverImageId: string | null;
  releaseYear: number | null;
}

/** Plataformas que lançaram no mesmo dia (preferindo a data do Brasil, depois a mundial). */
export interface PlatformRelease {
  /** YYYY-MM-DD (UTC, como o IGDB guarda). */
  date: string;
  precision: ReleasePrecision;
  platforms: string[];
}

export const gameLinkKinds = [
  // Lojas
  "steam",
  "playstation",
  "xbox",
  "nintendo",
  "epic",
  "gog",
  "itch",
  "gamejolt",
  "app_store",
  "google_play",
  // Outros
  "official",
  "wiki",
  "wikipedia",
  "reddit",
  "discord",
  "youtube",
  "twitch",
  "twitter",
  "bluesky",
  "instagram",
  "facebook",
] as const;
export type GameLinkKind = (typeof gameLinkKinds)[number];

export const storeLinkKinds: ReadonlySet<GameLinkKind> = new Set<GameLinkKind>([
  "steam",
  "playstation",
  "xbox",
  "nintendo",
  "epic",
  "gog",
  "itch",
  "gamejolt",
  "app_store",
  "google_play",
]);

export interface GameLink {
  kind: GameLinkKind;
  url: string;
}

export interface LanguageSupport {
  /** Nome no IGDB, ex.: "Portuguese (Brazil)". */
  name: string;
  audio: boolean;
  subtitles: boolean;
  interface: boolean;
}

/** Status do IGDB diferente de "lançado" (que é o normal e não ganha selo). */
export const gameReleaseStatuses = [
  "alpha",
  "beta",
  "early_access",
  "offline",
  "cancelled",
  "rumored",
  "delisted",
] as const;
export type GameReleaseStatus = (typeof gameReleaseStatuses)[number];

export const ageRatingOrgs = ["classind", "pegi", "esrb"] as const;
export type AgeRatingOrg = (typeof ageRatingOrgs)[number];

export interface AgeRating {
  org: AgeRatingOrg;
  /** Como o IGDB escreve: "16", "L", "M", "PEGI 18"… */
  rating: string;
}

export interface GameVideo {
  youtubeId: string;
  name: string;
}

export interface IgdbGamePage extends FeedGame {
  summary: string | null;
  storyline: string | null;
  /** Nota do público no IGDB (0–100, arredondada). */
  userRating: number | null;
  userRatingCount: number;
  status: GameReleaseStatus | null;
  developers: string[];
  publishers: string[];
  themes: string[];
  gameModes: string[];
  perspectives: string[];
  engines: string[];
  /** Em ordem de data. */
  releases: PlatformRelease[];
  /** Imagem larga para o banner (artwork ou screenshot); null se não houver. */
  heroImageId: string | null;
  screenshotIds: string[];
  /** Trailers primeiro. */
  videos: GameVideo[];
  links: GameLink[];
  languages: LanguageSupport[];
  /** ClassInd quando houver; senão PEGI ou ESRB. */
  ageRating: AgeRating | null;
  timeToBeat: TimeToBeat | null;
  /** Quantas pessoas informaram o tempo para zerar no IGDB. */
  timeToBeatCount: number;
  /** O jogo base, quando este é uma expansão, DLC ou remake. */
  parentGame: RelatedGame | null;
  related: {
    /** Expansões e expansões independentes. */
    expansions: RelatedGame[];
    dlcs: RelatedGame[];
    /** Remakes e remasters. */
    remakes: RelatedGame[];
    /** Outros jogos principais da mesma série ou franquia, por data. */
    series: RelatedGame[];
    similar: RelatedGame[];
  };
}

export const PT_BR_LANGUAGE = "Portuguese (Brazil)";

/** Suporte a português do Brasil, ou null se o jogo não tiver. */
export function ptBrSupport(languages: LanguageSupport[]): LanguageSupport | null {
  return languages.find((l) => l.name === PT_BR_LANGUAGE) ?? null;
}
