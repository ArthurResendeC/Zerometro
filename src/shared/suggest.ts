import { z } from "zod";
import { ttbByType } from "./completions";
import { diffInDays } from "./dates";
import { formatMinutes } from "./format";
import { genreLabel } from "./genres";
import type { LibraryItem } from "./library";

// "O que jogar agora?": escolhe entre os jogos em andamento, os próximos e os pausados pelo
// tempo que tenho e pelo clima. Função pura, usada pela web (funciona offline, com a biblioteca
// guardada no aparelho) e pelo MCP. Cada ponto da nota vem com o motivo, em português.

export const availableTimes = ["short", "medium", "long"] as const;
export const availableTimeSchema = z.enum(availableTimes);
export type AvailableTime = z.infer<typeof availableTimeSchema>;

export const availableTimeLabels: Record<AvailableTime, string> = {
  short: "30 min",
  medium: "1–2h",
  long: "Tarde toda",
};

/** Minutos que cada opção representa (para "dá para zerar hoje"). */
const AVAILABLE_MINUTES: Record<AvailableTime, number> = { short: 30, medium: 120, long: 300 };

export const moods = ["curto", "leve", "historia", "desafio", "coop"] as const;
export const moodSchema = z.enum(moods);
export type Mood = z.infer<typeof moodSchema>;

export const moodLabels: Record<Mood, string> = {
  curto: "Curto",
  leve: "Leve",
  historia: "História",
  desafio: "Desafio",
  coop: "Coop",
};

export interface SuggestOptions {
  available?: AvailableTime;
  mood?: Mood;
  /** Só jogos dessa plataforma (a em que joguei; sem ela, as do IGDB). */
  platform?: string;
  /** Hoje (YYYY-MM-DD), para "jogou ontem" e "parado há 3 semanas". */
  today: string;
}

export interface Suggestion {
  item: LibraryItem;
  score: number;
  /** Os motivos, do mais forte ao mais fraco. */
  reasons: string[];
  /** Quanto falta para o próximo alvo (história, depois extras e 100%); null sem tempo do IGDB. */
  remainingMinutes: number | null;
}

export interface SuggestResult {
  /** As 3 melhores. */
  top: Suggestion[];
  /** As 8 melhores, para o sorteio (a roleta). */
  pool: Suggestion[];
}

export const SUGGESTIONS_SHOWN = 3;
export const SUGGESTION_POOL = 8;

/** "Curto" = a história do IGDB em até isto. */
const SHORT_GAME_MINUTES = 8 * 60;
/** "Falta pouco" = até isto para o alvo. */
const ALMOST_DONE_MINUTES = 5 * 60;
/** Jogo longo para começar numa sessão curta. */
const LONG_GAME_MINUTES = 30 * 60;
const RECENT_DAYS = 3;
const STALE_DAYS = 14;

// Clima → gêneros, temas, modos e perspectivas do IGDB (nomes originais, ver genres.ts e
// game-labels.ts).
const LIGHT_GENRES = new Set([
  "Puzzle",
  "Platform",
  "Arcade",
  "Simulator",
  "Card & Board Game",
  "Music",
  "Quiz/Trivia",
  "Pinball",
  "Racing",
  "Sport",
]);
const LIGHT_THEMES = new Set(["Comedy", "Kids", "Party", "Sandbox"]);
const HEAVY_THEMES = new Set(["Horror", "Survival", "Thriller"]);
// "Adventure" sozinho não basta: o IGDB marca metroidvanias e plataformas assim (Silksong,
// Celeste). Só conta com um tema de história.
const STORY_GENRES = new Set(["Role-playing (RPG)", "Visual Novel", "Point-and-click"]);
const STORY_THEMES = new Set(["Drama", "Mystery", "Romance", "Thriller"]);
const CHALLENGE_GENRES = new Set([
  "Platform",
  "Fighting",
  "Hack and slash/Beat 'em up",
  "Shooter",
  "Real Time Strategy (RTS)",
  "Tactical",
]);
const CHALLENGE_THEMES = new Set(["Survival", "Warfare"]);
const COOP_MODES = new Set([
  "Co-operative",
  "Split screen",
  "Multiplayer",
  "Massively Multiplayer Online (MMO)",
]);

export function suggestGames(
  items: readonly LibraryItem[],
  options: SuggestOptions,
): SuggestResult {
  const scored = items
    .filter((item) => isCandidate(item, options))
    .map((item) => score(item, options))
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        (b.item.lastPlayedOn ?? "").localeCompare(a.item.lastPlayedOn ?? "") ||
        a.item.name.localeCompare(b.item.name),
    );
  const pool = scored.slice(0, SUGGESTION_POOL);
  return { top: pool.slice(0, SUGGESTIONS_SHOWN), pool };
}

/**
 * Sorteia uma sugestão do `pool`, com peso pela nota (as melhores saem mais, mas todas podem
 * sair). `random` em [0, 1), para os testes.
 */
export function pickSuggestion(
  pool: readonly Suggestion[],
  random: number = Math.random(),
): Suggestion | null {
  if (pool.length === 0) return null;
  const min = Math.min(...pool.map((s) => s.score));
  // Nota relativa à pior, mais 1: a pior ainda tem chance.
  const weights = pool.map((s) => s.score - min + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let target = random * total;
  for (const [i, suggestion] of pool.entries()) {
    target -= weights[i]!;
    if (target < 0) return suggestion;
  }
  return pool.at(-1)!;
}

/** Quanto falta para o alvo do progresso; null sem tempo do IGDB para ele. */
export function remainingMinutes(item: LibraryItem): number | null {
  const seconds = item.timeToBeat?.[ttbByType[item.progressTarget]];
  if (!seconds) return null;
  return Math.max(0, Math.round(seconds / 60) - item.minutesPlayed);
}

function isCandidate(item: LibraryItem, { mood, platform }: SuggestOptions): boolean {
  if (!["playing", "endless", "backlog", "paused"].includes(item.status)) return false;
  if (platform && !playableOn(item, platform)) return false;
  // Coop é obrigatório: sugerir um jogo solo para jogar com alguém não serve.
  if (mood === "coop" && !item.gameModes.some((m) => COOP_MODES.has(m))) return false;
  return true;
}

function playableOn(item: LibraryItem, platform: string): boolean {
  return item.platformPlayed ? item.platformPlayed === platform : item.platforms.includes(platform);
}

function score(item: LibraryItem, { available, mood, today }: SuggestOptions): Suggestion {
  const remaining = remainingMinutes(item);
  const reasons: [points: number, reason: string][] = [];
  let total = 0;
  /** Soma pontos (negativos tiram) e guarda o motivo dos positivos. */
  const bump = (points: number, reason?: string) => {
    total += points;
    if (reason && points > 0) reasons.push([points, reason]);
  };

  // Status: o que está em andamento vem antes.
  if (item.status === "paused") bump(0.5, "Está pausado: que tal retomar?");
  else if (item.status === "endless") {
    // Sem fim: não há o que zerar, mas uma partida cabe num tempo curto.
    bump(2);
    if (available === "short") bump(1, "Sem fim: uma partida cabe em pouco tempo");
  } else bump(item.status === "playing" ? 3 : 1);

  // Continuidade: jogou há pouco, ou está parado há muito.
  const daysAway = item.lastPlayedOn ? diffInDays(item.lastPlayedOn, today) : null;
  if ((item.status === "playing" || item.status === "endless") && daysAway !== null) {
    if (daysAway <= RECENT_DAYS) {
      bump(
        2,
        item.lastNote
          ? `Você parou em: ${item.lastNote.note}`
          : `Jogou ${daysAway <= 0 ? "hoje" : daysAway === 1 ? "ontem" : `há ${daysAway} dias`}: continue no embalo`,
      );
    } else if (daysAway >= STALE_DAYS) {
      bump(1, `Parado há ${Math.floor(daysAway / 7)} semanas`);
    }
  }

  // Tempo disponível.
  if (available && remaining !== null) {
    const minutes = AVAILABLE_MINUTES[available];
    if (remaining > 0 && remaining <= minutes) {
      bump(4, `Dá para zerar hoje: faltam ~${approx(remaining)}`);
    } else if (remaining <= ALMOST_DONE_MINUTES && available !== "long") {
      bump(2, `Falta pouco: ~${approx(remaining)}`);
    }
    const notStarted = item.minutesPlayed === 0;
    if (available === "short" && notStarted && remaining > LONG_GAME_MINUTES) bump(-2);
    if (available === "long" && notStarted) bump(1, "Uma tarde boa para começar");
  }

  // Clima.
  const genres = new Set(item.genres);
  const themes = new Set(item.themes);
  switch (mood) {
    case "curto": {
      const main = item.timeToBeat?.mainSec ? Math.round(item.timeToBeat.mainSec / 60) : null;
      if (main !== null && main <= SHORT_GAME_MINUTES) {
        bump(3, `Curto: ~${approx(main)} de história`);
      } else if (remaining !== null && remaining <= ALMOST_DONE_MINUTES) {
        bump(2, `Falta só ~${approx(remaining)}`);
      } else {
        bump(-2);
      }
      break;
    }
    case "leve": {
      const genre = firstOf(genres, LIGHT_GENRES);
      if (genre) bump(3, `Leve: ${genreLabel(genre)}`);
      else if (firstOf(themes, LIGHT_THEMES)) bump(2, "Leve e descontraído");
      if (firstOf(themes, HEAVY_THEMES)) bump(-3);
      break;
    }
    case "historia": {
      const genre = firstOf(genres, STORY_GENRES);
      const theme = firstOf(themes, STORY_THEMES);
      const points = genre
        ? theme
          ? 4
          : 3
        : theme
          ? genres.has("Adventure")
            ? 3
            : 2
          : item.perspectives.includes("Text")
            ? 3
            : 0;
      if (points > 0) bump(points, "Focado em história");
      break;
    }
    case "desafio": {
      const genre = firstOf(genres, CHALLENGE_GENRES);
      if (genre) bump(3, `Desafio: ${genreLabel(genre)}`);
      else if (firstOf(themes, CHALLENGE_THEMES)) bump(2, "Pede habilidade");
      break;
    }
    case "coop":
      bump(3, "Dá para jogar junto");
      break;
    case undefined:
      break;
  }

  return {
    item,
    score: total,
    reasons: reasons.toSorted((a, b) => b[0] - a[0]).map(([, reason]) => reason),
    remainingMinutes: remaining,
  };
}

/** O primeiro valor do jogo que está no conjunto do clima. */
function firstOf(values: Set<string>, pool: Set<string>): string | undefined {
  return [...values].find((x) => pool.has(x));
}

/** "~40min", "~3h": arredonda para a hora acima de 2h. */
function approx(minutes: number): string {
  return minutes >= 120 ? `${Math.round(minutes / 60)}h` : formatMinutes(minutes);
}
