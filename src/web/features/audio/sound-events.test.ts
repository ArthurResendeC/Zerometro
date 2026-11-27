import { describe, expect, test } from "bun:test";
import { pickSound, ratingSavedSounds, reachedStreakMilestone } from "./sound-events";

describe("pickSound", () => {
  test("sem eventos, nenhum som", () => {
    expect(pickSound([])).toBeNull();
    expect(pickSound([false, null, undefined])).toBeNull();
  });

  test("um evento só toca ele mesmo", () => {
    expect(pickSound(["session-start"])).toBe("session-start");
    expect(pickSound(["session-stop", false])).toBe("session-stop");
  });

  test("goal-reached > game-finished > streak-milestone > session-stop", () => {
    expect(pickSound(["session-stop", "streak-milestone", "game-finished", "goal-reached"])).toBe(
      "goal-reached",
    );
    expect(pickSound(["session-stop", "game-finished", "streak-milestone"])).toBe("game-finished");
    expect(pickSound(["session-stop", "streak-milestone"])).toBe("streak-milestone");
    expect(pickSound(["session-stop", null])).toBe("session-stop");
  });

  test("trocar de jogo com marco da ofensiva: o marco ganha do início da sessão", () => {
    expect(pickSound(["session-start", "streak-milestone"])).toBe("streak-milestone");
  });
});

describe("reachedStreakMilestone", () => {
  test.each([
    [6, 7],
    [29, 30],
    [99, 100],
    [364, 365],
  ])("%i → %i toca", (before, current) => {
    expect(reachedStreakMilestone({ before, current })).toBe(true);
  });

  test.each([
    [7, 8],
    [7, 7],
    [5, 6],
    [30, 31],
    [365, 366],
    [0, 0],
  ])("%i → %i não toca", (before, current) => {
    expect(reachedStreakMilestone({ before, current })).toBe(false);
  });

  test("pular um marco de uma vez (sessão retroativa que liga duas ofensivas) também toca", () => {
    expect(reachedStreakMilestone({ before: 3, current: 10 })).toBe(true);
  });

  test("ofensiva caindo não toca", () => {
    expect(reachedStreakMilestone({ before: 30, current: 0 })).toBe(false);
  });
});

describe("ratingSavedSounds", () => {
  test("salvar soa como jogo salvo; nota final 9+ comemora", () => {
    expect(pickSound(ratingSavedSounds(8.9))).toBe("session-stop");
    expect(pickSound(ratingSavedSounds(9))).toBe("goal-reached");
  });
});
