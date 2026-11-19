import { z } from "zod";

// Contrato das estatísticas (dashboard e tool `get_stats` do MCP).

export interface StreakStats {
  /** Dias seguidos com pelo menos `minMinutes` jogados; vale até ontem para não zerar antes de jogar hoje. */
  current: number;
  currentStartedOn: string | null;
  best: number;
  bestFrom: string | null;
  bestTo: string | null;
  /** Mínimo diário configurado. */
  minMinutes: number;
  /** Hoje já atingiu o mínimo. */
  todayCounts: boolean;
  /** Minutos que faltam hoje para contar (0 se já contou). */
  todayRemainingMinutes: number;
  /** A ofensiva está viva só até ontem: se não jogar o mínimo hoje, zera amanhã. */
  atRisk: boolean;
}

export interface PeriodStats {
  /** Dias no período (limitado ao primeiro dia com sessão). */
  days: number;
  totalMinutes: number;
  playedDays: number;
  /** Média contando todos os dias do período. */
  perDay: number;
  /** Média só dos dias em que joguei. */
  perPlayedDay: number;
}

export interface WeekStats {
  /** Segunda-feira da semana (YYYY-MM-DD). */
  weekStart: string;
  minutes: number;
}

export interface TopGame {
  gameId: number;
  name: string;
  coverImageId: string | null;
  minutes: number;
}

export interface Stats {
  today: string;
  todayMinutes: number;
  thisWeekMinutes: number;
  totalMinutes: number;
  streak: StreakStats;
  /** Últimos 30 dias. */
  last30Days: PeriodStats;
  /** Média por semana nas últimas 8 semanas. */
  weeklyAverageMinutes: number;
  /** Últimas 8 semanas, da mais antiga para a atual. */
  weeks: WeekStats[];
  /** Jogos mais jogados nos últimos 30 dias. */
  topGames: TopGame[];
}

// ---------------------------------------------------------------------------
// Heatmap (estilo GitHub)

/** Período das estatísticas: um ano de calendário ou, sem ano, os últimos 12 meses. */
export const statsPeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type StatsPeriod = z.infer<typeof statsPeriodSchema>;

export interface HeatmapDay {
  date: string;
  minutes: number;
}

export interface Heatmap {
  /** Primeiro e último dia do período (YYYY-MM-DD), ambos inclusos. */
  from: string;
  to: string;
  today: string;
  year: number | null;
  /** Só os dias com tempo jogado, em ordem. */
  days: HeatmapDay[];
  totalMinutes: number;
  playedDays: number;
  /** Mínimo diário da ofensiva (o primeiro degrau da escala de cor). */
  streakMinMinutes: number;
  /** Anos com alguma sessão, mais o atual (para o seletor), do mais recente ao mais antigo. */
  years: number[];
}

// ---------------------------------------------------------------------------
// Detalhamento do período (página de estatísticas)

export interface GenreStat {
  /** Nome do gênero no IGDB (em inglês; a interface traduz). */
  genre: string;
  /** Minutos em jogos desse gênero: um jogo com vários gêneros conta inteiro em cada um. */
  minutes: number;
  /** Jogos diferentes desse gênero jogados no período. */
  games: number;
}

export interface PeriodBreakdown {
  from: string;
  to: string;
  year: number | null;
  totalMinutes: number;
  genres: GenreStat[];
  /** Jogos mais jogados no período. */
  games: TopGame[];
}

// ---------------------------------------------------------------------------
// Ritmo: quando e por quanto tempo eu jogo

export interface WeekdayStat {
  /** 0 = segunda … 6 = domingo. */
  weekday: number;
  minutes: number;
  /** Média por ocorrência desse dia da semana no período (contando os dias sem jogar). */
  avgMinutes: number;
}

export interface HourStat {
  /** Hora local de início da faixa (0–23). */
  hour: number;
  minutes: number;
}

/** Faixas de duração das sessões, em minutos: [min, max). */
export const sessionLengthBuckets = [
  { min: 0, max: 30 },
  { min: 30, max: 60 },
  { min: 60, max: 120 },
  { min: 120, max: 180 },
  { min: 180, max: null },
] as const;

export interface Rhythm {
  from: string;
  to: string;
  year: number | null;
  weekdays: WeekdayStat[];
  /** Minutos em cada hora do dia, só das sessões de timer (as únicas com horário). */
  hours: HourStat[];
  timerSessions: number;
  /** Quantas sessões em cada faixa de `sessionLengthBuckets`. */
  sessionLengths: number[];
  sessions: number;
  /** Duração mediana das sessões, em minutos (null sem sessões). */
  medianSessionMinutes: number | null;
}

// ---------------------------------------------------------------------------
// Recordes e zerados do período

export interface FinishedGame {
  gameId: number;
  name: string;
  coverImageId: string | null;
  finishedAt: string;
  /** Total jogado (sessões + tempo anterior ao Zerômetro). */
  minutesPlayed: number;
  /** Tempo da história no IGDB, em minutos (null se o IGDB não tiver). */
  storyMinutes: number | null;
  rating: number | null;
}

export interface Records {
  from: string;
  to: string;
  year: number | null;
  longestSession: { minutes: number; playedOn: string; gameId: number; name: string } | null;
  bestDay: { date: string; minutes: number } | null;
  bestWeek: { weekStart: string; minutes: number } | null;
  /** Zerados por mês (YYYY-MM), do primeiro ao último mês do período (até hoje). */
  finishedByMonth: { month: string; count: number }[];
  /** Zerados no período, do mais recente ao mais antigo. */
  finished: FinishedGame[];
  /**
   * Seu ritmo comparado ao IGDB: tempo jogado ÷ tempo da história, somando os zerados do
   * período que têm esse tempo (1,3 = você leva 30% a mais). null sem nenhum.
   */
  paceRatio: number | null;
}
