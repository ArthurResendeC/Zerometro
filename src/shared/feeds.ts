import type { IgdbGameSummary } from "./igdb";

// Listas do IGDB na tela inicial (as mesmas para todos os usuários, atualizadas 1x por dia).

export const feedKeys = ["top_rated", "trending", "upcoming"] as const;
export type FeedKey = (typeof feedKeys)[number];

export const feedTitles: Record<FeedKey, string> = {
  top_rated: "Lançamentos bem avaliados",
  trending: "Em alta",
  upcoming: "Próximos lançamentos",
};

/** Quão exata é a data de lançamento (o IGDB usa 31/12 quando só o ano é conhecido). */
export type ReleasePrecision = "day" | "month" | "quarter" | "year";

export interface FeedGame extends IgdbGameSummary {
  /** Nota da crítica (0–100, arredondada), estilo Metacritic. */
  criticRating: number | null;
  criticRatingCount: number;
  /** Expectativa no IGDB (quantas pessoas seguem o jogo antes do lançamento). */
  hypes: number;
  /** YYYY-MM-DD (UTC, como o IGDB guarda). */
  releaseDate: string | null;
  releasePrecision: ReleasePrecision | null;
}

export interface Feed {
  key: FeedKey;
  games: FeedGame[];
  /** Quando a lista foi buscada no IGDB (ISO); null se nunca foi. */
  updatedAt: string | null;
}
