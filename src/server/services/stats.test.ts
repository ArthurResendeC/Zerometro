import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { addToLibrary } from "./library";
import { logSession } from "./sessions";
import { getStats } from "./stats";

// TEST_TODAY = 2026-11-19, uma quinta-feira (semana começa na segunda, 16).

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
]);

let ctx: ServiceContext;
let persona: number;
let undertale: number;

beforeEach(async () => {
  ctx = createTestContext();
  persona = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
  undertale = (await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" })).gameId;
});

function play(playedOn: string, minutes: number, gameId = persona) {
  logSession(ctx, { gameId, minutes, playedOn });
}

const stats = (streakMinMinutes = 30) => getStats(ctx.db, { today: TEST_TODAY, streakMinMinutes });

describe("ofensiva", () => {
  test("sem sessões, tudo zerado", () => {
    const s = stats();
    expect(s.streak).toEqual({
      current: 0,
      currentStartedOn: null,
      best: 0,
      bestFrom: null,
      bestTo: null,
      minMinutes: 30,
      todayCounts: false,
      todayRemainingMinutes: 30,
      atRisk: false,
    });
    expect(s.totalMinutes).toBe(0);
    expect(s.weeks).toHaveLength(8);
  });

  test("só conta dias que atingem o mínimo, somando sessões e jogos do dia", () => {
    play("2026-11-10", 60);
    play("2026-11-11", 60);
    play("2026-11-12", 60);
    play("2026-11-15", 40);
    play("2026-11-16", 20); // abaixo do mínimo: quebra a ofensiva
    play("2026-11-17", 30); // exatamente o mínimo conta
    play("2026-11-18", 15);
    play("2026-11-18", 20, undertale); // 35 no dia

    const { streak } = stats();
    expect(streak).toMatchObject({
      current: 2,
      currentStartedOn: "2026-11-17",
      best: 3,
      bestFrom: "2026-11-10",
      bestTo: "2026-11-12",
      todayCounts: false,
      todayRemainingMinutes: 30,
      atRisk: true, // vale até ontem; precisa jogar hoje
    });
  });

  test("jogar o mínimo hoje estende a ofensiva e tira o risco", () => {
    play("2026-11-18", 45);
    play(TEST_TODAY, 10);
    expect(stats().streak).toMatchObject({ current: 1, todayRemainingMinutes: 20, atRisk: true });

    play(TEST_TODAY, 25);
    expect(stats().streak).toMatchObject({
      current: 2,
      currentStartedOn: "2026-11-18",
      best: 2,
      todayCounts: true,
      todayRemainingMinutes: 0,
      atRisk: false,
    });
  });

  test("um dia inteiro sem jogar zera a atual, mas mantém o recorde", () => {
    play("2026-11-16", 60);
    play("2026-11-17", 60);

    expect(stats().streak).toMatchObject({ current: 0, best: 2, atRisk: false });
  });

  test("o mínimo configurado muda quais dias contam", () => {
    play("2026-11-16", 15);
    play("2026-11-17", 15);
    play("2026-11-18", 15);

    expect(stats(30).streak.current).toBe(0);
    expect(stats(10).streak.current).toBe(3);
  });
});

describe("totais e médias", () => {
  test("médias começam no primeiro dia jogado (não diluem com dias antes do app)", () => {
    play("2026-11-17", 60);
    play(TEST_TODAY, 30, undertale);

    const s = stats();
    expect(s.todayMinutes).toBe(30);
    expect(s.thisWeekMinutes).toBe(90);
    expect(s.totalMinutes).toBe(90);
    expect(s.last30Days).toEqual({
      days: 3,
      totalMinutes: 90,
      playedDays: 2,
      perDay: 30,
      perPlayedDay: 45,
    });
    // Menos de uma semana de histórico: a média semanal é o próprio total.
    expect(s.weeklyAverageMinutes).toBe(90);
    expect(s.weeks.at(-1)).toEqual({ weekStart: "2026-11-16", minutes: 90 });
    expect(s.weeks[0]?.weekStart).toBe("2026-09-28");
  });

  test("média semanal divide pelo número de semanas do período", () => {
    play("2026-09-01", 600); // antes das 8 semanas (que começam em 28/09)
    play("2026-11-02", 120);
    play("2026-11-10", 120);

    const s = stats();
    // 28/09 a 19/11 = 53 dias ≈ 7,6 semanas → 240 / 7,57 ≈ 32
    expect(s.weeklyAverageMinutes).toBe(32);
    expect(s.last30Days.days).toBe(30);
    expect(s.totalMinutes).toBe(840);
  });

  test("jogos mais jogados nos últimos 30 dias", () => {
    play("2026-10-01", 600); // fora da janela
    play("2026-11-18", 40);
    play("2026-11-18", 90, undertale);
    play(TEST_TODAY, 30);

    expect(stats().topGames.map((g) => [g.name, g.minutes])).toEqual([
      ["Undertale", 90],
      ["Persona 5 Royal", 70],
    ]);
  });
});
