import { diffInDays } from "./dates";
import type { CompletionType, GameStatus } from "./domain";

// Linha do tempo: quando joguei cada jogo no período, com as pausas e as conclusões.
// Contrato do card das Estatísticas e da tool `get_timeline` do MCP.

/** Mais que isso de dias seguidos sem jogar quebra a barra do jogo numa pausa. */
export const TIMELINE_PAUSE_DAYS = 14;

/** Um trecho de jogo contínuo, sem nenhuma pausa no meio. */
export interface TimelineSpan {
  /** Primeiro e último dia do trecho (YYYY-MM-DD), recortados ao período. */
  from: string;
  to: string;
  /** Minutos e dias jogados no trecho, só os de dentro do período. */
  minutes: number;
  playedDays: number;
  /** O trecho já vinha de antes do período ou segue depois dele (a barra encosta na borda). */
  startedBefore: boolean;
  continuesAfter: boolean;
}

export interface TimelinePause {
  /** Último dia jogado antes da pausa e o dia em que voltou. */
  lastPlayedOn: string;
  resumedOn: string;
  /** Dias sem jogar entre os dois. */
  days: number;
}

export interface TimelineCompletion {
  completedOn: string;
  type: CompletionType;
}

export interface TimelineGame {
  gameId: number;
  /** Id no IGDB: é por ele que a página do jogo é aberta. */
  igdbId: number;
  name: string;
  coverImageId: string | null;
  /** Status de hoje na biblioteca. */
  status: GameStatus;
  /** Minutos jogados no período. */
  minutes: number;
  spans: TimelineSpan[];
  /** Conclusões no período, da mais antiga para a mais recente. */
  completions: TimelineCompletion[];
}

export interface Timeline {
  from: string;
  to: string;
  today: string;
  year: number | null;
  pauseDays: number;
  /** Jogos com sessão ou conclusão no período, em ordem de quando apareceram nele. */
  games: TimelineGame[];
}

export interface PlayedDay {
  date: string;
  minutes: number;
}

/**
 * Agrupa os dias jogados de um jogo (em ordem) em trechos separados por mais de `pauseDays`
 * dias sem jogar, e recorta ao período [from, to]: um trecho que atravessa a borda fica com a
 * parte de dentro e a marca de que vinha de antes (ou segue depois).
 */
export function timelineSpans(
  days: PlayedDay[],
  { from, to, pauseDays = TIMELINE_PAUSE_DAYS }: { from: string; to: string; pauseDays?: number },
): TimelineSpan[] {
  const groups: PlayedDay[][] = [];
  for (const day of days) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last && diffInDays(last.date, day.date) - 1 <= pauseDays) group.push(day);
    else groups.push([day]);
  }

  return groups.flatMap((group) => {
    const inside = group.filter((d) => d.date >= from && d.date <= to);
    if (inside.length === 0) return [];
    const startedBefore = group[0]!.date < from;
    const continuesAfter = group.at(-1)!.date > to;
    return {
      from: startedBefore ? from : inside[0]!.date,
      to: continuesAfter ? to : inside.at(-1)!.date,
      minutes: inside.reduce((sum, d) => sum + d.minutes, 0),
      playedDays: inside.length,
      startedBefore,
      continuesAfter,
    };
  });
}

/** As pausas entre os trechos de um jogo. */
export function timelinePauses(spans: TimelineSpan[]): TimelinePause[] {
  return spans.slice(1).map((span, i) => {
    const lastPlayedOn = spans[i]!.to;
    return {
      lastPlayedOn,
      resumedOn: span.from,
      days: diffInDays(lastPlayedOn, span.from) - 1,
    };
  });
}

/** Primeiro dia em que o jogo aparece no período (trecho ou conclusão). */
export function timelineStart(game: TimelineGame): string {
  const dates = [game.spans[0]?.from, game.completions[0]?.completedOn].filter(
    (d): d is string => d !== undefined,
  );
  return dates.toSorted()[0] ?? "";
}
