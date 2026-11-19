import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { addDays, diffInDays, startOfWeek } from "../../shared/dates";
import type {
  Heatmap,
  HeatmapQuery,
  PeriodStats,
  Stats,
  StreakStats,
  TopGame,
  WeekStats,
} from "../../shared/stats";
import type { UserScope } from "./context";
import { games, playSessions } from "../db/schema";
import { getSettings } from "./settings";

const WEEKS_SHOWN = 8;
const TOP_GAMES = 5;

interface StatsOptions {
  today: string;
  streakMinMinutes: number;
}

export function getStats(scope: UserScope, { today, streakMinMinutes }: StatsOptions): Stats {
  const firstDay = firstPlayedOn(scope);
  const weeksFrom = addDays(startOfWeek(today), -7 * (WEEKS_SHOWN - 1));
  const daily = minutesByDay(scope, weeksFrom, today);
  const todayMinutes = daily.get(today) ?? 0;

  const last30Days = periodStats(daily, addDays(today, -29), today, firstDay);
  // Semanas de calendário (segunda a domingo), as mesmas do gráfico; a atual vale pelos dias já passados.
  const lastWeeks = periodStats(daily, weeksFrom, today, firstDay);

  return {
    today,
    todayMinutes,
    thisWeekMinutes: sumRange(daily, startOfWeek(today), today),
    totalMinutes: allTimeMinutes(scope),
    streak: streakStats(scope, today, todayMinutes, streakMinMinutes),
    last30Days,
    // Com menos de uma semana de histórico, a média é o total (não extrapola).
    weeklyAverageMinutes: Math.round(lastWeeks.totalMinutes / Math.max(1, lastWeeks.days / 7)),
    weeks: weekSeries(daily, weeksFrom),
    topGames: topGames(scope, addDays(today, -29), today),
  };
}

// ---------------------------------------------------------------------------
// Ofensiva

interface StreakRow {
  start: string;
  end: string;
  days: number;
}

/**
 * Ofensivas por "gaps and islands": dias que atingiram o mínimo, agrupados por
 * `data - posição`, que é constante enquanto os dias forem consecutivos.
 */
function streaks({ db, userId }: UserScope, minMinutes: number): StreakRow[] {
  return db.all<StreakRow>(sql`
    with days as (
      select ${playSessions.playedOn} as d
      from ${playSessions}
      where ${playSessions.userId} = ${userId} and ${playSessions.minutes} is not null
      group by ${playSessions.playedOn}
      having sum(${playSessions.minutes}) >= ${minMinutes}
    ),
    islands as (
      select d, julianday(d) - row_number() over (order by d) as grp from days
    )
    select min(d) as start, max(d) as "end", count(*) as days
    from islands group by grp order by "end" desc
  `);
}

/** A ofensiva mais recente, se ainda estiver viva (terminou hoje ou ontem). */
function aliveStreak(rows: StreakRow[], today: string): StreakRow | undefined {
  const latest = rows[0];
  return latest && latest.end >= addDays(today, -1) ? latest : undefined;
}

/** Ofensiva atual com o mínimo diário dos ajustes do usuário. */
export function currentStreak(scope: UserScope, today: string): number {
  return aliveStreak(streaks(scope, getSettings(scope).streakMinMinutes), today)?.days ?? 0;
}

function streakStats(
  { db, userId }: UserScope,
  today: string,
  todayMinutes: number,
  minMinutes: number,
): StreakStats {
  const rows = streaks({ db, userId }, minMinutes);
  const alive = aliveStreak(rows, today);
  // Em empate, o recorde mais recente.
  const best = rows.reduce<StreakRow | undefined>(
    (acc, row) => (acc && acc.days >= row.days ? acc : row),
    undefined,
  );
  const todayCounts = todayMinutes >= minMinutes;

  return {
    current: alive?.days ?? 0,
    currentStartedOn: alive?.start ?? null,
    best: best?.days ?? 0,
    bestFrom: best?.start ?? null,
    bestTo: best?.end ?? null,
    minMinutes,
    todayCounts,
    todayRemainingMinutes: Math.max(0, minMinutes - todayMinutes),
    atRisk: Boolean(alive) && !todayCounts,
  };
}

// ---------------------------------------------------------------------------
// Totais e médias

function minutesByDay({ db, userId }: UserScope, from: string, to: string): Map<string, number> {
  const rows = db
    .select({ day: playSessions.playedOn, minutes: sql<number>`sum(${playSessions.minutes})` })
    .from(playSessions)
    .where(
      and(
        eq(playSessions.userId, userId),
        gte(playSessions.playedOn, from),
        lte(playSessions.playedOn, to),
        isNotNull(playSessions.minutes),
      ),
    )
    .groupBy(playSessions.playedOn)
    .all();
  return new Map(rows.map((r) => [r.day, r.minutes]));
}

function sumRange(daily: Map<string, number>, from: string, to: string): number {
  let total = 0;
  for (const [day, minutes] of daily) if (day >= from && day <= to) total += minutes;
  return total;
}

/** Período [from, to], começando no primeiro dia com sessão se ele for mais recente. */
function periodStats(
  daily: Map<string, number>,
  from: string,
  to: string,
  firstDay: string | null,
): PeriodStats {
  const start = firstDay && firstDay > from ? firstDay : from;
  const days = Math.max(1, diffInDays(start, to) + 1);
  let totalMinutes = 0;
  let playedDays = 0;
  for (const [day, minutes] of daily) {
    if (day < start || day > to) continue;
    totalMinutes += minutes;
    playedDays += 1;
  }
  return {
    days,
    totalMinutes,
    playedDays,
    perDay: Math.round(totalMinutes / days),
    perPlayedDay: playedDays ? Math.round(totalMinutes / playedDays) : 0,
  };
}

function weekSeries(daily: Map<string, number>, firstWeek: string): WeekStats[] {
  return Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const weekStart = addDays(firstWeek, 7 * i);
    return { weekStart, minutes: sumRange(daily, weekStart, addDays(weekStart, 6)) };
  });
}

function firstPlayedOn({ db, userId }: UserScope): string | null {
  return (
    db
      .select({ day: sql<string | null>`min(${playSessions.playedOn})` })
      .from(playSessions)
      .where(and(eq(playSessions.userId, userId), isNotNull(playSessions.minutes)))
      .get()?.day ?? null
  );
}

function allTimeMinutes({ db, userId }: UserScope): number {
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(eq(playSessions.userId, userId))
      .get()?.total ?? 0
  );
}

function topGames({ db, userId }: UserScope, from: string, to: string): TopGame[] {
  const minutes = sql<number>`sum(${playSessions.minutes})`;
  return db
    .select({
      gameId: games.id,
      name: games.name,
      coverImageId: games.coverImageId,
      minutes,
    })
    .from(playSessions)
    .innerJoin(games, eq(games.id, playSessions.gameId))
    .where(
      and(
        eq(playSessions.userId, userId),
        gte(playSessions.playedOn, from),
        lte(playSessions.playedOn, to),
        isNotNull(playSessions.minutes),
      ),
    )
    .groupBy(games.id)
    .orderBy(desc(minutes), games.name)
    .limit(TOP_GAMES)
    .all();
}

// ---------------------------------------------------------------------------
// Heatmap

/**
 * Minutos por dia para o heatmap: um ano de calendário ou, sem ano, os últimos 12 meses
 * (as 53 colunas do GitHub: da segunda-feira de 52 semanas atrás até hoje).
 * Tempo anterior ao Zerômetro não entra: não tem dia.
 */
export function getHeatmap(
  scope: UserScope,
  { today, streakMinMinutes, year }: StatsOptions & HeatmapQuery,
): Heatmap {
  const currentYear = Number(today.slice(0, 4));
  const from = year ? `${year}-01-01` : addDays(startOfWeek(today), -7 * 52);
  const lastDay = year ? `${year}-12-31` : today;
  const to = lastDay > today ? today : lastDay;

  const days =
    from > to
      ? []
      : [...minutesByDay(scope, from, to)]
          .map(([date, minutes]) => ({ date, minutes }))
          .toSorted((a, b) => a.date.localeCompare(b.date));

  return {
    from,
    to: lastDay,
    today,
    year: year ?? null,
    days,
    totalMinutes: days.reduce((sum, d) => sum + d.minutes, 0),
    playedDays: days.length,
    streakMinMinutes,
    years: playedYears(scope, currentYear),
  };
}

function playedYears({ db, userId }: UserScope, currentYear: number): number[] {
  const rows = db
    .selectDistinct({ year: sql<string>`substr(${playSessions.playedOn}, 1, 4)` })
    .from(playSessions)
    .where(and(eq(playSessions.userId, userId), isNotNull(playSessions.minutes)))
    .all();
  return [...new Set([currentYear, ...rows.map((r) => Number(r.year))])].toSorted((a, b) => b - a);
}
