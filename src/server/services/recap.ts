import { sql } from "drizzle-orm";
import { addDays, diffInDays, zonedParts } from "../../shared/dates";
import {
  type DayPart,
  dayParts,
  lastClosedRecapDate,
  type Recap,
  type RecapAchievement,
  type RecapGame,
  type RecapPeriod,
  type RecapProfile,
  RECAP_PROFILE_MIN_MINUTES,
  RECAP_RETURN_DAYS,
  type ReturningGame,
  recapRange,
  shiftRecap,
} from "../../shared/recap";
import type { Records } from "../../shared/stats";
import type { UserScope } from "./context";
import {
  closedSessions,
  finishedInPeriod,
  firstPlayedOn,
  genreStats,
  longestSession,
  minutesByDay,
  spreadOverHours,
  weekdayOf,
} from "./stats";

const TOP = 5;
/** Folga ao comparar a base da Steam com as sessões (arredondamentos da sincronização). */
const STEAM_BASELINE_SLACK_MINUTES = 30;

interface RecapOptions {
  today: string;
  timeZone: string;
  period: RecapPeriod;
  /** Qualquer dia do período; sem data, o último período fechado. */
  date?: string;
}

export function getRecap(scope: UserScope, { today, timeZone, period, date }: RecapOptions): Recap {
  // Um período que ainda não começou vira o atual: não há o que mostrar no futuro.
  let { from, to } = recapRange(period, date ?? lastClosedRecapDate(period, today));
  if (from > today) ({ from, to } = recapRange(period, today));

  const daily = minutesByDay(scope, from, to);
  const days = eachDay(from, to).map((day) => ({ date: day, minutes: daily.get(day) ?? 0 }));
  const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);

  const prev = recapRange(period, shiftRecap(period, from, -1));
  const firstDay = firstPlayedOn(scope);
  const nextFrom = shiftRecap(period, from, 1);

  const games = periodGames(scope, from, to);
  const { finished, summary } = finishedInPeriod(scope, from, to);

  return {
    period,
    from,
    to,
    today,
    inProgress: to >= today,
    previous: firstDay && prev.to >= firstDay ? prev.from : null,
    next: nextFrom <= today ? nextFrom : null,

    totalMinutes,
    previousMinutes: [...minutesByDay(scope, prev.from, prev.to).values()].reduce(
      (sum, m) => sum + m,
      0,
    ),
    sessions: games.reduce((sum, g) => sum + g.sessions, 0),
    playedDays: daily.size,
    daily: days,
    longestRun: longestRun(days),

    gamesPlayed: games.length,
    topGames: games.slice(0, TOP).map(toRecapGame),
    topGenres: genreStats(scope, from, to).slice(0, TOP),
    newGames: games.filter((g) => isFirstTime(g)).map(toRecapGame),
    returningGames: returningGames(games),

    bestDay: bestDay(days),
    longestSession: longestSession(scope, from, to),
    finished: finished.map(({ priorMinutes: _prior, steamMinutes: _steam, ...game }) => game),
    finishedSummary: summary,
    achievements: periodAchievements(scope, from, to, timeZone),
    profile: profile(scope, from, to, timeZone, days, totalMinutes),
  };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

function longestRun(days: { minutes: number }[]): number {
  let best = 0;
  let run = 0;
  for (const { minutes } of days) {
    run = minutes > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Em empate, o mais recente (como nos recordes). */
function bestDay(days: { date: string; minutes: number }[]): Records["bestDay"] {
  let best: Records["bestDay"] = null;
  for (const day of days) {
    if (day.minutes > 0 && (!best || day.minutes >= best.minutes)) best = { ...day };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Jogos do período

interface PeriodGameRow extends RecapGame {
  /** Primeira sessão dentro do período. */
  firstOn: string;
  /** Última sessão antes do período (null se nunca tinha jogado no Zerômetro). */
  lastBefore: string | null;
  priorMinutes: number | null;
  /** Total da Steam já contado menos todas as sessões do jogo: o que havia antes da base. */
  steamBefore: number;
}

function periodGames({ db, userId }: UserScope, from: string, to: string): PeriodGameRow[] {
  return db.all<PeriodGameRow>(sql`
    select g.id as gameId, g.igdb_id as igdbId, g.name as name, g.cover_image_id as coverImageId,
      sum(s.minutes) as minutes,
      count(*) as sessions,
      min(s.played_on) as firstOn,
      (
        select max(p.played_on) from play_sessions p
        where p.user_id = s.user_id and p.game_id = g.id and p.played_on < ${from}
          and p.minutes is not null
      ) as lastBefore,
      e.prior_minutes as priorMinutes,
      coalesce(e.steam_counted_minutes, 0) - coalesce((
        select sum(p.minutes) from play_sessions p
        where p.user_id = s.user_id and p.game_id = g.id and p.minutes is not null
      ), 0) as steamBefore
    from play_sessions s
    join games g on g.id = s.game_id
    left join library_entries e on e.user_id = s.user_id and e.game_id = g.id
    where s.user_id = ${userId} and s.played_on between ${from} and ${to} and s.minutes is not null
    group by g.id
    order by minutes desc, g.name
  `);
}

function toRecapGame({ gameId, igdbId, name, coverImageId, minutes, sessions }: PeriodGameRow) {
  return { gameId, igdbId, name, coverImageId, minutes, sessions } satisfies RecapGame;
}

/**
 * Estreia: a primeira sessão no Zerômetro caiu no período e não havia tempo de antes (nem o
 * informado, nem o que a Steam já tinha na primeira sincronização).
 */
function isFirstTime(game: PeriodGameRow): boolean {
  return (
    game.lastBefore === null &&
    !game.priorMinutes &&
    game.steamBefore <= STEAM_BASELINE_SLACK_MINUTES
  );
}

function returningGames(games: PeriodGameRow[]): ReturningGame[] {
  return games
    .flatMap((game) => {
      if (!game.lastBefore) return [];
      const daysAway = diffInDays(game.lastBefore, game.firstOn);
      if (daysAway < RECAP_RETURN_DAYS) return [];
      const { sessions: _sessions, ...base } = toRecapGame(game);
      return [{ ...base, daysAway }];
    })
    .toSorted((a, b) => b.daysAway - a.daysAway || b.minutes - a.minutes);
}

// ---------------------------------------------------------------------------
// Conquistas

interface UnlockRow {
  title: string;
  iconUrl: string | null;
  rarity: number | null;
  unlockedAt: string;
  gameId: number;
  igdbId: number;
  gameName: string;
}

/** Desbloqueios no período, pelo dia local (o banco guarda o instante em UTC). */
function periodAchievements(
  { db, userId }: UserScope,
  from: string,
  to: string,
  timeZone: string,
): Recap["achievements"] {
  // Um dia de folga de cada lado cobre qualquer fuso; o recorte exato é feito abaixo.
  const rows = db.all<UnlockRow>(sql`
    select a.title as title, a.icon_url as iconUrl, a.rarity as rarity,
      u.unlocked_at as unlockedAt,
      min(us.game_id) as gameId, g.igdb_id as igdbId, g.name as gameName
    from achievement_unlocks u
    join achievements a on a.id = u.achievement_id
    join user_achievement_sets us on us.set_id = a.set_id and us.user_id = u.user_id
    join games g on g.id = us.game_id
    where u.user_id = ${userId}
      and u.unlocked_at >= ${addDays(from, -1)} and u.unlocked_at < ${addDays(to, 2)}
      and a.removed_at is null
    group by u.id
  `);
  // (Com um único min(), o SQLite tira as colunas soltas da mesma linha: o jogo é o de menor id.)

  let rarest: RecapAchievement | null = null;
  const gameIds = new Set<number>();
  let unlocked = 0;
  for (const row of rows) {
    const unlockedOn = zonedParts(new Date(row.unlockedAt), timeZone).date;
    if (unlockedOn < from || unlockedOn > to) continue;
    unlocked++;
    gameIds.add(row.gameId);
    if (row.rarity === null) continue;
    // Em empate, a mais recente.
    if (
      !rarest ||
      row.rarity < rarest.rarity ||
      (row.rarity === rarest.rarity && unlockedOn >= rarest.unlockedOn)
    ) {
      rarest = {
        title: row.title,
        iconUrl: row.iconUrl,
        rarity: row.rarity,
        gameId: row.gameId,
        igdbId: row.igdbId,
        gameName: row.gameName,
        unlockedOn,
      };
    }
  }
  return { unlocked, games: gameIds.size, rarest };
}

// ---------------------------------------------------------------------------
// Perfil

const DAY_PART_OF_HOUR: DayPart[] = Array.from(
  { length: 24 },
  (_, hour) => dayParts[Math.floor(hour / 6)]!,
);

function profile(
  scope: UserScope,
  from: string,
  to: string,
  timeZone: string,
  days: { date: string; minutes: number }[],
  totalMinutes: number,
): RecapProfile {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const row of closedSessions(scope, from, to)) {
    if (!row.startedAt || !row.endedAt) continue;
    spreadOverHours(new Date(row.startedAt), new Date(row.endedAt), timeZone, hours);
  }
  const parts = new Map<DayPart, number>();
  hours.forEach((minutes, hour) => {
    const part = DAY_PART_OF_HOUR[hour]!;
    parts.set(part, (parts.get(part) ?? 0) + minutes);
  });
  const timedMinutes = hours.reduce((sum, m) => sum + m, 0);
  // Em empate, o mais tarde no dia (a ordem do Map é madrugada → noite).
  let top: [DayPart, number] | null = null;
  for (const entry of parts) if (!top || entry[1] >= top[1]) top = entry;
  const hasProfile = top && timedMinutes >= RECAP_PROFILE_MIN_MINUTES;

  const weekend = days.filter((d) => weekdayOf(d.date) >= 5).reduce((sum, d) => sum + d.minutes, 0);

  return {
    timedMinutes: Math.round(timedMinutes),
    dayPart: hasProfile ? top![0] : null,
    dayPartShare: hasProfile ? round2(top![1] / timedMinutes) : null,
    weekendShare: totalMinutes > 0 ? round2(weekend / totalMinutes) : null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
