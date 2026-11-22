import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { completionRank } from "../../shared/completions";
import { addDays, diffInDays, startOfWeek, zonedParts } from "../../shared/dates";
import { sessionLengthBuckets } from "../../shared/stats";
import type {
  GenreStat,
  Heatmap,
  PeriodBreakdown,
  FinishedGame,
  PeriodStats,
  Records,
  Rhythm,
  Stats,
  StatsPeriod,
  StreakStats,
  TopGame,
  WeekStats,
} from "../../shared/stats";
import type { UserScope } from "./context";
import { completions, games, playSessions } from "../db/schema";
import { listLibrary } from "./library";
import { getSettings } from "./settings";

const WEEKS_SHOWN = 8;
const TOP_GAMES = 5;
const PERIOD_TOP_GAMES = 10;

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

export function minutesByDay(
  { db, userId }: UserScope,
  from: string,
  to: string,
): Map<string, number> {
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

export function firstPlayedOn({ db, userId }: UserScope): string | null {
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

function topGames(
  { db, userId }: UserScope,
  from: string,
  to: string,
  limit = TOP_GAMES,
): TopGame[] {
  const minutes = sql<number>`sum(${playSessions.minutes})`;
  return db
    .select({
      gameId: games.id,
      igdbId: games.igdbId,
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
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// Heatmap

/**
 * Período das estatísticas: um ano de calendário (até 31/12, mesmo que ainda não tenha chegado)
 * ou, sem ano, os últimos 12 meses como o GitHub: da segunda-feira de 52 semanas atrás até hoje.
 */
export function statsPeriodRange(today: string, year?: number): { from: string; to: string } {
  return year
    ? { from: `${year}-01-01`, to: `${year}-12-31` }
    : { from: addDays(startOfWeek(today), -7 * 52), to: today };
}

/** Minutos por dia para o heatmap. Tempo anterior ao Zerômetro não entra: não tem dia. */
export function getHeatmap(
  scope: UserScope,
  { today, streakMinMinutes, year }: StatsOptions & StatsPeriod,
): Heatmap {
  const { from, to } = statsPeriodRange(today, year);
  const until = to > today ? today : to;
  const days =
    from > until
      ? []
      : [...minutesByDay(scope, from, until)]
          .map(([date, minutes]) => ({ date, minutes }))
          .toSorted((a, b) => a.date.localeCompare(b.date));

  return {
    from,
    to,
    today,
    year: year ?? null,
    days,
    totalMinutes: days.reduce((sum, d) => sum + d.minutes, 0),
    playedDays: days.length,
    streakMinMinutes,
    years: playedYears(scope, Number(today.slice(0, 4))),
  };
}

/** Gêneros e jogos mais jogados no período (o mesmo recorte do heatmap). */
export function getPeriodBreakdown(
  scope: UserScope,
  { today, year }: { today: string } & StatsPeriod,
): PeriodBreakdown {
  const { from, to } = statsPeriodRange(today, year);
  const daily = minutesByDay(scope, from, to);
  return {
    from,
    to,
    year: year ?? null,
    totalMinutes: sumRange(daily, from, to),
    genres: genreStats(scope, from, to),
    games: topGames(scope, from, to, PERIOD_TOP_GAMES),
  };
}

export function genreStats({ db, userId }: UserScope, from: string, to: string): GenreStat[] {
  return db.all<GenreStat>(sql`
    select genre.value as genre,
      sum(${playSessions.minutes}) as minutes,
      count(distinct ${playSessions.gameId}) as games
    from ${playSessions}
    join ${games} on ${games.id} = ${playSessions.gameId}
    join json_each(${games.genres}) as genre
    where ${playSessions.userId} = ${userId}
      and ${playSessions.playedOn} between ${from} and ${to}
      and ${playSessions.minutes} is not null
    group by genre.value
    order by minutes desc, genre.value
  `);
}

function playedYears({ db, userId }: UserScope, currentYear: number): number[] {
  const rows = db
    .selectDistinct({ year: sql<string>`substr(${playSessions.playedOn}, 1, 4)` })
    .from(playSessions)
    .where(and(eq(playSessions.userId, userId), isNotNull(playSessions.minutes)))
    .all();
  return [...new Set([currentYear, ...rows.map((r) => Number(r.year))])].toSorted((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Ritmo

/** Dia da semana de uma data de calendário: 0 = segunda … 6 = domingo. */
export function weekdayOf(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function getRhythm(
  scope: UserScope,
  { today, timeZone, year }: { today: string; timeZone: string } & StatsPeriod,
): Rhythm {
  const { from, to } = statsPeriodRange(today, year);
  const rows = closedSessions(scope, from, to);

  // Médias por dia da semana: dias do período desde o primeiro jogado até hoje (ou o fim).
  const weekdayMinutes = Array.from({ length: 7 }, () => 0);
  for (const row of rows) weekdayMinutes[weekdayOf(row.playedOn)]! += row.minutes;
  const firstDay = firstPlayedOn(scope);
  const start = firstDay && firstDay > from ? firstDay : from;
  const end = to > today ? today : to;
  const occurrences = Array.from({ length: 7 }, () => 0);
  if (start <= end) {
    for (let day = start; day <= end; day = addDays(day, 1)) occurrences[weekdayOf(day)]! += 1;
  }

  // Horas do dia: cada sessão de timer é repartida pelas horas locais que ela cobre.
  const hourMinutes = Array.from({ length: 24 }, () => 0);
  let timerSessions = 0;
  for (const row of rows) {
    if (!row.startedAt || !row.endedAt) continue;
    timerSessions += 1;
    spreadOverHours(new Date(row.startedAt), new Date(row.endedAt), timeZone, hourMinutes);
  }

  const lengths = rows.map((r) => r.minutes).toSorted((a, b) => a - b);
  return {
    from,
    to,
    year: year ?? null,
    weekdays: weekdayMinutes.map((minutes, weekday) => ({
      weekday,
      minutes,
      avgMinutes: occurrences[weekday] ? Math.round(minutes / occurrences[weekday]) : 0,
    })),
    hours: hourMinutes.map((minutes, hour) => ({ hour, minutes: Math.round(minutes) })),
    timerSessions,
    sessionLengths: sessionLengthBuckets.map(
      ({ min, max }) => lengths.filter((m) => m >= min && (max === null || m < max)).length,
    ),
    sessions: lengths.length,
    medianSessionMinutes: median(lengths),
  };
}

interface SessionRow {
  playedOn: string;
  minutes: number;
  startedAt: string | null;
  endedAt: string | null;
}

export function closedSessions({ db, userId }: UserScope, from: string, to: string): SessionRow[] {
  return db
    .select({
      playedOn: playSessions.playedOn,
      minutes: sql<number>`${playSessions.minutes}`,
      startedAt: playSessions.startedAt,
      endedAt: playSessions.endedAt,
    })
    .from(playSessions)
    .where(
      and(
        eq(playSessions.userId, userId),
        gte(playSessions.playedOn, from),
        lte(playSessions.playedOn, to),
        isNotNull(playSessions.minutes),
      ),
    )
    .all();
}

/** Soma em `buckets[hora local]` os minutos de [start, end), cortando nas viradas de hora. */
export function spreadOverHours(start: Date, end: Date, timeZone: string, buckets: number[]): void {
  let cursor = start.getTime();
  const stop = end.getTime();
  while (cursor < stop) {
    const { time } = zonedParts(new Date(cursor), timeZone);
    const [hour, minute] = time.split(":").map(Number) as [number, number];
    const seconds = new Date(cursor).getUTCSeconds() * 1000 + new Date(cursor).getUTCMilliseconds();
    const nextHour = cursor + (60 - minute) * 60_000 - seconds;
    const until = Math.min(nextHour, stop);
    buckets[hour]! += (until - cursor) / 60_000;
    cursor = until;
  }
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// ---------------------------------------------------------------------------
// Recordes e zerados

export function getRecords(
  scope: UserScope,
  { today, year }: { today: string } & StatsPeriod,
): Records {
  const { from, to } = statsPeriodRange(today, year);
  const daily = minutesByDay(scope, from, to);

  let bestDay: Records["bestDay"] = null;
  const weekly = new Map<string, number>();
  for (const [date, minutes] of [...daily].toSorted(([a], [b]) => a.localeCompare(b))) {
    // Em empate, o mais recente.
    if (!bestDay || minutes >= bestDay.minutes) bestDay = { date, minutes };
    const week = startOfWeek(date);
    weekly.set(week, (weekly.get(week) ?? 0) + minutes);
  }
  let bestWeek: Records["bestWeek"] = null;
  for (const [weekStart, minutes] of weekly) {
    if (!bestWeek || minutes >= bestWeek.minutes) bestWeek = { weekStart, minutes };
  }

  const { finished, summary, byMonth, firstInPeriod } = finishedInPeriod(scope, from, to);

  // Ritmo: só quem zerou pela primeira vez no período, com o tempo jogado até aquele dia.
  let story = 0;
  let played = 0;
  for (const game of finished) {
    const firstOn = firstInPeriod.get(game.gameId);
    if (!firstOn || !game.storyMinutes) continue;
    // No modo Steam não dá para saber quanto levou até zerar: vale o total de lá.
    const minutes =
      game.steamMinutes ?? minutesUntil(scope, game.gameId, firstOn) + game.priorMinutes;
    if (minutes === 0) continue;
    story += game.storyMinutes;
    played += minutes;
  }

  const lastMonth = (to > today ? today : to).slice(0, 7);
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= lastMonth; month = nextMonth(month)) {
    months.push(month);
  }

  return {
    from,
    to,
    year: year ?? null,
    longestSession: longestSession(scope, from, to),
    bestDay,
    bestWeek,
    finishedByMonth: months.map((month) => ({ month, count: byMonth.get(month)?.size ?? 0 })),
    finished: finished.map(({ priorMinutes: _prior, steamMinutes: _steam, ...game }) => game),
    finishedSummary: summary,
    paceRatio: story > 0 ? Math.round((played / story) * 100) / 100 : null,
  };
}

/**
 * Jogos com conclusão no período, a partir de todas as conclusões do usuário (as anteriores ao
 * período dizem o que é replay e o que é a primeira vez).
 */
export function finishedInPeriod(scope: UserScope, from: string, to: string) {
  const items = new Map(listLibrary(scope).map((item) => [item.gameId, item]));
  const rows = scope.db
    .select({
      gameId: completions.gameId,
      type: completions.type,
      completedOn: completions.completedOn,
    })
    .from(completions)
    .where(and(eq(completions.userId, scope.userId), lte(completions.completedOn, to)))
    .orderBy(asc(completions.completedOn), asc(completions.id))
    .all();

  /** Maior nível já alcançado em cada jogo, conforme as conclusões vão passando. */
  const reached = new Map<number, number>();
  const byGame = new Map<
    number,
    FinishedGame & { priorMinutes: number; steamMinutes: number | null }
  >();
  /** Jogos distintos zerados em cada mês (história + 100% no mesmo mês contam uma vez). */
  const byMonth = new Map<string, Set<number>>();
  /** Primeira conclusão de todas, quando ela cai no período. */
  const firstInPeriod = new Map<number, string>();
  let replays = 0;

  for (const row of rows) {
    const rank = completionRank(row.type);
    const before = reached.get(row.gameId);
    reached.set(row.gameId, Math.max(before ?? -1, rank));
    const item = items.get(row.gameId);
    if (row.completedOn < from || !item) continue;

    const isReplay = before !== undefined && rank <= before;
    if (isReplay) replays++;
    if (before === undefined) firstInPeriod.set(row.gameId, row.completedOn);
    const month = row.completedOn.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? new Set()).add(row.gameId));

    const game = byGame.get(row.gameId);
    if (game) {
      game.completedOn = row.completedOn;
      if (rank > completionRank(game.type)) game.type = row.type;
      game.completions++;
      if (isReplay) game.replays++;
    } else {
      byGame.set(row.gameId, {
        gameId: item.gameId,
        igdbId: item.igdbId,
        name: item.name,
        coverImageId: item.coverImageId,
        completedOn: row.completedOn,
        type: row.type,
        completions: 1,
        replays: isReplay ? 1 : 0,
        minutesPlayed: item.minutesPlayed,
        priorMinutes: item.priorMinutes,
        steamMinutes:
          item.playtimeSource === "steam" && item.steamPlaytime ? item.steamPlaytime.minutes : null,
        storyMinutes: item.timeToBeat?.mainSec ? Math.round(item.timeToBeat.mainSec / 60) : null,
        rating: item.rating,
      });
    }
  }

  const finished = [...byGame.values()].toSorted(
    (a, b) => b.completedOn.localeCompare(a.completedOn) || a.name.localeCompare(b.name),
  );
  return {
    finished,
    byMonth,
    firstInPeriod,
    summary: {
      games: finished.length,
      replays,
      full: finished.filter((g) => g.type === "full").length,
    },
  };
}

/** Minutos de sessões do jogo até o dia informado (inclusive). */
function minutesUntil({ db, userId }: UserScope, gameId: number, date: string): number {
  return (
    db
      .select({ minutes: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(
        and(
          eq(playSessions.userId, userId),
          eq(playSessions.gameId, gameId),
          lte(playSessions.playedOn, date),
          isNotNull(playSessions.minutes),
        ),
      )
      .get()?.minutes ?? 0
  );
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function longestSession(
  { db, userId }: UserScope,
  from: string,
  to: string,
): Records["longestSession"] {
  return (
    db
      .select({
        minutes: sql<number>`${playSessions.minutes}`,
        playedOn: playSessions.playedOn,
        gameId: games.id,
        igdbId: games.igdbId,
        name: games.name,
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
      .orderBy(desc(playSessions.minutes), desc(playSessions.playedOn))
      .limit(1)
      .get() ?? null
  );
}
