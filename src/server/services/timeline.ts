import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { StatsPeriod } from "../../shared/stats";
import {
  type PlayedDay,
  TIMELINE_PAUSE_DAYS,
  type Timeline,
  type TimelineCompletion,
  type TimelineGame,
  timelineSpans,
  timelineStart,
} from "../../shared/timeline";
import { completions, playSessions } from "../db/schema";
import type { UserScope } from "./context";
import { listLibrary } from "./library";
import { statsPeriodRange } from "./stats";

/**
 * Linha do tempo do período (o mesmo recorte do heatmap): os trechos jogados de cada jogo e as
 * conclusões. Os dias de fora do período também são lidos, para saber se um trecho vinha de
 * antes ou segue depois dele.
 */
export function getTimeline(
  scope: UserScope,
  { today, year }: { today: string } & StatsPeriod,
): Timeline {
  const { from, to } = statsPeriodRange(today, year);
  const until = to > today ? today : to;
  const empty = { from, to, today, year: year ?? null, pauseDays: TIMELINE_PAUSE_DAYS, games: [] };
  if (from > until) return empty;

  const daysByGame = new Map<number, PlayedDay[]>();
  const dayRows = scope.db
    .select({
      gameId: playSessions.gameId,
      date: playSessions.playedOn,
      minutes: sql<number>`sum(${playSessions.minutes})`,
    })
    .from(playSessions)
    .where(and(eq(playSessions.userId, scope.userId), isNotNull(playSessions.minutes)))
    .groupBy(playSessions.gameId, playSessions.playedOn)
    .orderBy(asc(playSessions.gameId), asc(playSessions.playedOn))
    .all();
  for (const { gameId, date, minutes } of dayRows) {
    const days = daysByGame.get(gameId) ?? [];
    days.push({ date, minutes });
    daysByGame.set(gameId, days);
  }

  const completionsByGame = new Map<number, TimelineCompletion[]>();
  const completionRows = scope.db
    .select({
      gameId: completions.gameId,
      completedOn: completions.completedOn,
      type: completions.type,
    })
    .from(completions)
    .where(
      and(
        eq(completions.userId, scope.userId),
        gte(completions.completedOn, from),
        lte(completions.completedOn, until),
      ),
    )
    .orderBy(asc(completions.completedOn), asc(completions.id))
    .all();
  for (const { gameId, ...completion } of completionRows) {
    completionsByGame.set(gameId, [...(completionsByGame.get(gameId) ?? []), completion]);
  }

  const games: TimelineGame[] = [];
  for (const item of listLibrary(scope)) {
    const spans = timelineSpans(daysByGame.get(item.gameId) ?? [], { from, to: until });
    const gameCompletions = completionsByGame.get(item.gameId) ?? [];
    if (spans.length === 0 && gameCompletions.length === 0) continue;
    games.push({
      gameId: item.gameId,
      igdbId: item.igdbId,
      name: item.name,
      coverImageId: item.coverImageId,
      status: item.status,
      minutes: spans.reduce((sum, span) => sum + span.minutes, 0),
      spans,
      completions: gameCompletions,
    });
  }

  return {
    ...empty,
    games: games.toSorted(
      (a, b) => timelineStart(a).localeCompare(timelineStart(b)) || a.name.localeCompare(b.name),
    ),
  };
}
