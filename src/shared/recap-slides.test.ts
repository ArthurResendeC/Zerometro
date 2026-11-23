import { describe, expect, test } from "bun:test";
import type { Recap } from "./recap";
import { recapSlides } from "./recap-slides";

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
