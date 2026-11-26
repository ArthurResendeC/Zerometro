import { z } from "zod";

// Tipos e helpers do IGDB usados pela API, frontend e MCP.

export interface TimeToBeat {
  /** Só a história, jogando rápido (`hastily` no IGDB). */
  mainSec: number | null;
  /** História + extras (`normally`). */
  extraSec: number | null;
  /** 100% (`completely`). */
  completeSec: number | null;
}

export interface IgdbGameSummary {
  igdbId: number;
  name: string;
  slug: string | null;
  coverImageId: string | null;
  platforms: string[];
  genres: string[];
  releaseYear: number | null;
  /** Ex.: "Jogo", "Remaster", "Port". Ajuda a escolher a versão certa. */
  gameType: string | null;
}

/** Empresa num jogo (`involved_companies`): só quem desenvolveu ou publicou. */
export interface IgdbCompanyCredit {
  igdbId: number;
  name: string;
  developer: boolean;
  publisher: boolean;
}

/** Série (`collections`) ou franquia (`franchises`) do IGDB. */
export interface IgdbNamedRef {
  igdbId: number;
  name: string;
}

export interface IgdbGameDetails extends IgdbGameSummary {
  timeToBeat: TimeToBeat | null;
  /** App na Steam (de `external_games`), para ligar a lista de conquistas sozinho. */
  steamAppId: number | null;
  themes: string[];
  gameModes: string[];
  /** `player_perspectives` (primeira pessoa, terceira pessoa, visão de cima…). */
  perspectives: string[];
  companies: IgdbCompanyCredit[];
  /** A "série" de verdade (Zelda, Mario 3D…). */
  collections: IgdbNamedRef[];
  /** Mais amplo que a série (ex.: a franquia Mario inteira). */
  franchises: IgdbNamedRef[];
}

/** Só o resumo de um jogo com detalhes (o que a busca devolve). */
export function toGameSummary(details: IgdbGameDetails): IgdbGameSummary {
  const { igdbId, name, slug, coverImageId, platforms, genres, releaseYear, gameType } = details;
  return { igdbId, name, slug, coverImageId, platforms, genres, releaseYear, gameType };
}

export const igdbSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Digite pelo menos 2 caracteres").max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const igdbIdSchema = z.coerce.number().int().positive();

export type CoverSize =
  | "thumb"
  | "cover_small"
  | "cover_big"
  | "screenshot_med"
  | "screenshot_big"
  | "720p"
  | "1080p";

/** Qualquer imagem do IGDB (capa, artwork, screenshot) pelo id, no tamanho pedido. */
export function coverUrl(imageId: string, size: CoverSize = "cover_big"): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

/** Página do jogo no site do IGDB (busca pelo nome se não houver slug). */
export function igdbGameUrl(game: { slug: string | null; name: string }): string {
  return game.slug
    ? `https://www.igdb.com/games/${game.slug}`
    : `https://www.igdb.com/search?type=1&q=${encodeURIComponent(game.name)}`;
}
