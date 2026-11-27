import type { CriterionAverage } from "./ratings";
import { z } from "zod";

// Perfil de gamer: o "meu gosto" calculado a partir da biblioteca (devs, publishers, séries,
// gêneros…). Tipos e ordenação usados pela API, pela página /perfil e pelo MCP.

export const profileSorts = ["minutes", "finished", "rating"] as const;
export const profileSortSchema = z.enum(profileSorts);
export type ProfileSort = z.infer<typeof profileSortSchema>;

export const profileSortLabels: Record<ProfileSort, string> = {
  minutes: "Horas jogadas",
  finished: "Zerados",
  rating: "Nota média",
};

/** Na ordem por nota, só entra quem tem pelo menos isto de jogos com nota (1 jogo só não vale). */
export const MIN_RATED_GAMES = 2;

/** Jogos mostrados em cada linha (capas), os mais jogados primeiro. */
export const PROFILE_ROW_GAMES = 6;

export interface ProfileGameRef {
  gameId: number;
  igdbId: number;
  name: string;
  coverImageId: string | null;
}

export interface ProfileRow {
  /** Identidade estável da linha (id do IGDB da empresa/série, ou o próprio nome). */
  key: string;
  name: string;
  /** Total jogado nos jogos da linha (o mesmo total da biblioteca, com o tempo de antes). */
  minutes: number;
  games: number;
  /** Jogos zerados (com conclusão ou no status Zerado). */
  finished: number;
  /** Média das minhas notas (1–10), com 1 casa; null sem nenhum jogo com nota. */
  avgRating: number | null;
  ratedGames: number;
  /** Os jogos da linha, os mais jogados primeiro (até `PROFILE_ROW_GAMES`). */
  topGames: ProfileGameRef[];
}

export interface GamerProfile {
  /** Jogos que entram no perfil: com tempo jogado ou alguma conclusão. */
  gamesCounted: number;
  totalMinutes: number;
  developers: ProfileRow[];
  publishers: ProfileRow[];
  /** `collections` do IGDB: a série de verdade (Zelda, Persona…). */
  series: ProfileRow[];
  /** `franchises` do IGDB: mais amplas que as séries. */
  franchises: ProfileRow[];
  /** Nomes do IGDB em inglês (a tela traduz os gêneros com `genreLabel`). */
  genres: ProfileRow[];
  themes: ProfileRow[];
  perspectives: ProfileRow[];
  gameModes: ProfileRow[];
  /** Pela plataforma em que joguei (`platformPlayed`). */
  platforms: ProfileRow[];
  /** Média de cada critério da avaliação guiada ("o que você mais valoriza"), maior primeiro. */
  criteria: CriterionAverage[];
}

export const profileSections = [
  "developers",
  "publishers",
  "series",
  "franchises",
  "genres",
  "themes",
  "perspectives",
  "gameModes",
  "platforms",
] as const satisfies readonly (keyof GamerProfile)[];
export type ProfileSection = (typeof profileSections)[number];

/**
 * Ordena um ranking: por horas (só quem tem tempo), por zerados (só quem zerou algum) ou por
 * nota média (só quem tem `MIN_RATED_GAMES` jogos com nota). Empate: mais horas, depois o nome.
 */
export function sortProfileRows(rows: readonly ProfileRow[], by: ProfileSort): ProfileRow[] {
  const tiebreak = (a: ProfileRow, b: ProfileRow) =>
    b.minutes - a.minutes || b.games - a.games || a.name.localeCompare(b.name);
  switch (by) {
    case "minutes":
      return rows.filter((r) => r.minutes > 0).toSorted(tiebreak);
    case "finished":
      return rows
        .filter((r) => r.finished > 0)
        .toSorted((a, b) => b.finished - a.finished || tiebreak(a, b));
    case "rating":
      return rows
        .filter((r) => r.ratedGames >= MIN_RATED_GAMES && r.avgRating !== null)
        .toSorted((a, b) => b.avgRating! - a.avgRating! || tiebreak(a, b));
  }
}
