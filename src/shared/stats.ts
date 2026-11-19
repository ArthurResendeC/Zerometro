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

export const heatmapQuerySchema = z.object({
  /** Ano de calendário; sem ano, os últimos 12 meses até hoje. */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>;

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
