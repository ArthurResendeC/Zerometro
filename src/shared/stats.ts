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
