import { describe, expect, test } from "bun:test";
import type { Recap } from "@shared/recap";
import {
  comparison,
  periodLabel,
  profileFacts,
  profileTitle,
  recapKicker,
  recapSlides,
} from "./recap-text";

const game = {
  gameId: 1,
  igdbId: 10,
  name: "Hades",
  coverImageId: null,
  minutes: 60,
  sessions: 1,
};

function recap(overrides: Partial<Recap> = {}): Recap {
  return {
    period: "week",
    from: "2026-11-09",
    to: "2026-11-15",
    today: "2026-11-19",
    inProgress: false,
    previous: null,
    next: "2026-11-16",
    totalMinutes: 0,
    previousMinutes: 0,
    sessions: 0,
    playedDays: 0,
    daily: [],
    longestRun: 0,
    gamesPlayed: 0,
    topGames: [],
    topGenres: [],
    newGames: [],
    returningGames: [],
    bestDay: null,
    longestSession: null,
    finished: [],
    finishedSummary: { games: 0, replays: 0, full: 0 },
    achievements: { unlocked: 0, games: 0, rarest: null },
    profile: { timedMinutes: 0, dayPart: null, dayPartShare: null, weekendShare: null },
    ...overrides,
  };
}

describe("recapSlides", () => {
  test("sem nada no período, só o vazio", () => {
    expect(recapSlides(recap())).toEqual(["empty"]);
  });

  test("só os slides com dados", () => {
    const slides = recapSlides(
      recap({
        totalMinutes: 60,
        topGames: [game],
        topGenres: [{ genre: "Indie", minutes: 60, games: 1 }],
        bestDay: { date: "2026-11-10", minutes: 60 },
        profile: { timedMinutes: 0, dayPart: null, dayPartShare: null, weekendShare: 0.2 },
      }),
    );
    expect(slides).toEqual(["intro", "games", "genres", "moments", "summary"]);
  });

  test("conquistas sem sessões ainda rendem um recap", () => {
    const slides = recapSlides(recap({ achievements: { unlocked: 2, games: 1, rarest: null } }));
    expect(slides).toEqual(["intro", "trophies", "summary"]);
  });
});

describe("textos", () => {
  test("rótulo do período e chamada", () => {
    expect(periodLabel("week", "2026-11-09", "2026-11-15")).toMatch(/^9 a 15 de nov\.?$/);
    expect(periodLabel("week", "2026-12-28", "2027-01-03")).toMatch(/^28 de dez\.? a 3 de jan\.?$/);
    expect(periodLabel("month", "2026-11-01", "2026-11-30")).toBe("novembro de 2026");
    expect(recapKicker("month", "2026-11-01")).toBe("Seu novembro");
    expect(recapKicker("week", "2026-11-09")).toBe("Sua semana");
  });

  test("comparação com o período anterior", () => {
    expect(comparison("week", 135, 100)).toEqual({
      trend: "up",
      text: "35% a mais que a semana anterior",
    });
    expect(comparison("month", 50, 100)).toEqual({
      trend: "down",
      text: "50% a menos que o mês anterior",
    });
    expect(comparison("week", 60, 0)).toEqual({
      trend: "up",
      text: "Nada jogado na semana anterior",
    });
    expect(comparison("month", 0, 0).text).toBe("Igual ao mês anterior");
  });

  test("perfil: período do dia primeiro; fim de semana só acima de 60%", () => {
    const night = { timedMinutes: 150, dayPart: "night", dayPartShare: 0.7, weekendShare: 0.42 };
    expect(profileTitle({ ...night, dayPart: "night" })).toBe("Jogador noturno");
    expect(profileFacts({ ...night, dayPart: "night" })).toEqual([
      "70% do tempo cronometrado foi à noite",
      "42% do tempo no fim de semana",
    ]);
    const none = { timedMinutes: 0, dayPart: null, dayPartShare: null };
    expect(profileTitle({ ...none, weekendShare: 0.8 })).toBe("Guerreiro de fim de semana");
    expect(profileTitle({ ...none, weekendShare: 0.5 })).toBeNull();
  });
});
