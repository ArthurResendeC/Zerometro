import { z } from "zod";
import { addDays, isoDateSchema, startOfWeek } from "./dates";
import type { FinishedGame, GenreStat, Records, TopGame } from "./stats";

// Recap da semana (segunda a domingo) ou do mês, no estilo "retrospectiva": a página de slides e,
// depois, a imagem para compartilhar.

export const recapPeriods = ["week", "month"] as const;
export type RecapPeriod = (typeof recapPeriods)[number];

export const recapQuerySchema = z.object({
  period: z.enum(recapPeriods),
  /** Qualquer dia do período; sem data, o último período já fechado. */
  date: isoDateSchema.optional(),
});
export type RecapQuery = z.infer<typeof recapQuerySchema>;

/** Imagem para compartilhar: stories (1080×1920) ou paisagem 16:9 (1920×1080). */
export const recapImageFormats = ["story", "wide"] as const;
export type RecapImageFormat = (typeof recapImageFormats)[number];

export const recapImageSizes: Record<RecapImageFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  wide: { width: 1920, height: 1080 },
};

export const recapImageQuerySchema = recapQuerySchema.extend({
  format: z.enum(recapImageFormats).default("story"),
});

/** Primeiro e último dia (inclusos) da semana ou do mês que contém `date`. */
export function recapRange(period: RecapPeriod, date: string): { from: string; to: string } {
  if (period === "week") {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 7)}-01`;
  return { from, to: addDays(shiftMonth(from, 1), -1) };
}

/** Primeiro dia do período `delta` períodos antes (negativo) ou depois do que contém `date`. */
export function shiftRecap(period: RecapPeriod, date: string, delta: number): string {
  const { from } = recapRange(period, date);
  return period === "week" ? addDays(from, 7 * delta) : shiftMonth(from, delta);
}

/** Primeiro dia do último período fechado: a semana passada ou o mês passado. */
export function lastClosedRecapDate(period: RecapPeriod, today: string): string {
  return shiftRecap(period, today, -1);
}

/** "2026-11-01" + 1 → "2026-12-01" (sempre a partir do dia 1). */
function shiftMonth(firstDay: string, delta: number): string {
  const [y, m] = firstDay.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Período do dia, em horas locais: madrugada 0–5, manhã 6–11, tarde 12–17, noite 18–23. */
export const dayParts = ["dawn", "morning", "afternoon", "night"] as const;
export type DayPart = (typeof dayParts)[number];

/** Minutos com horário necessários para arriscar um perfil. */
export const RECAP_PROFILE_MIN_MINUTES = 60;
/** Dias sem jogar a partir dos quais voltar a um jogo conta como retorno. */
export const RECAP_RETURN_DAYS = 30;

export interface RecapGame extends TopGame {
  sessions: number;
}

export interface ReturningGame extends TopGame {
  /** Dias entre a última sessão antes do período e a primeira dentro dele. */
  daysAway: number;
}

export interface RecapAchievement {
  title: string;
  iconUrl: string | null;
  /** % global de quem desbloqueou. */
  rarity: number;
  gameId: number;
  igdbId: number;
  gameName: string;
  /** Dia local do desbloqueio (YYYY-MM-DD). */
  unlockedOn: string;
}

export interface RecapProfile {
  /** Minutos de sessões com horário (timer e Steam), os únicos que dizem a hora do dia. */
  timedMinutes: number;
  /** Período do dia com mais minutos; null com menos de `RECAP_PROFILE_MIN_MINUTES` com horário. */
  dayPart: DayPart | null;
  /** Fatia desse período nos minutos com horário (0–1). */
  dayPartShare: number | null;
  /** Fatia de sábado e domingo no total (0–1); null sem minutos. */
  weekendShare: number | null;
}

export interface Recap {
  period: RecapPeriod;
  from: string;
  to: string;
  today: string;
  /** O período ainda não acabou: os números são parciais. */
  inProgress: boolean;
  /** Primeiro dia do período anterior; null antes do primeiro dia jogado. */
  previous: string | null;
  /** Primeiro dia do próximo período; null se ele ainda não começou. */
  next: string | null;

  totalMinutes: number;
  /** Total do período anterior, para comparar. */
  previousMinutes: number;
  sessions: number;
  playedDays: number;
  /** Todos os dias do período, inclusive os sem jogar e os que ainda não chegaram. */
  daily: { date: string; minutes: number }[];
  /** Mais dias seguidos jogando dentro do período. */
  longestRun: number;

  /** Jogos diferentes no período. */
  gamesPlayed: number;
  /** Os 5 mais jogados. */
  topGames: RecapGame[];
  /** Os 5 gêneros mais jogados (um jogo conta inteiro em cada gênero). */
  topGenres: GenreStat[];
  /** Primeira vez jogando: a 1ª sessão é no período e não havia tempo de antes do Zerômetro. */
  newGames: RecapGame[];
  /** Voltou a jogar depois de `RECAP_RETURN_DAYS` dias ou mais. */
  returningGames: ReturningGame[];

  bestDay: Records["bestDay"];
  longestSession: Records["longestSession"];
  finished: FinishedGame[];
  finishedSummary: Records["finishedSummary"];
  achievements: {
    unlocked: number;
    /** Jogos com algum desbloqueio. */
    games: number;
    /** A de menor % global (entre as que têm %). */
    rarest: RecapAchievement | null;
  };
  profile: RecapProfile;
}
