import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { addToLibrary } from "./library";
import { logSession } from "./sessions";
import { getHeatmap, getPeriodBreakdown, getStats } from "./stats";

// TEST_TODAY = 2026-11-19, uma quinta-feira (semana começa na segunda, 16).

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 113112, name: "Hades", genres: ["Role-playing (RPG)", "Indie"] }),
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

const stats = (streakMinMinutes = 30) => getStats(ctx, { today: TEST_TODAY, streakMinMinutes });
const heatmap = (year?: number) =>
  getHeatmap(ctx, { today: TEST_TODAY, streakMinMinutes: 30, year });

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

describe("heatmap", () => {
  test("sem ano: as 53 semanas até hoje, só os dias jogados, em ordem", () => {
    play("2025-11-16", 60); // domingo antes da primeira coluna: fora
    play("2025-11-17", 45); // segunda-feira de 52 semanas atrás: primeira coluna
    play("2026-11-19", 20);
    play("2026-11-19", 10, undertale);
    play("2026-03-02", 90);

    const h = heatmap();

    expect(h).toMatchObject({ from: "2025-11-17", to: TEST_TODAY, today: TEST_TODAY, year: null });
    expect(h.days).toEqual([
      { date: "2025-11-17", minutes: 45 },
      { date: "2026-03-02", minutes: 90 },
      { date: "2026-11-19", minutes: 30 },
    ]);
    expect(h).toMatchObject({ totalMinutes: 165, playedDays: 3, streakMinMinutes: 30 });
  });

  test("com ano: o ano inteiro (até 31/12) e os anos com sessões para o seletor", () => {
    play("2025-12-31", 60);
    play("2026-01-01", 30);
    play("2024-06-10", 15);

    const h = heatmap(2025);

    expect(h).toMatchObject({ from: "2025-01-01", to: "2025-12-31", year: 2025 });
    expect(h.days).toEqual([{ date: "2025-12-31", minutes: 60 }]);
    expect(h.years).toEqual([2026, 2025, 2024]);
    expect(heatmap(2026).to).toBe("2026-12-31");
    expect(heatmap(2030)).toMatchObject({ days: [], totalMinutes: 0 });
  });
});

describe("detalhamento do período", () => {
  test("gêneros: jogo com vários gêneros conta inteiro em cada um; só o período", async () => {
    const hades = (await addToLibrary(ctx, igdb, { igdbId: 113112, status: "playing" })).gameId;
    play("2026-11-10", 60); // Persona: RPG
    play("2026-11-11", 30, hades); // RPG + Indie
    play("2026-11-12", 20, undertale); // RPG
    play("2025-01-05", 500); // fora dos últimos 12 meses

    const b = getPeriodBreakdown(ctx, { today: TEST_TODAY });

    expect(b).toMatchObject({ from: "2025-11-17", to: TEST_TODAY, year: null, totalMinutes: 110 });
    expect(b.genres).toEqual([
      { genre: "Role-playing (RPG)", minutes: 110, games: 3 },
      { genre: "Indie", minutes: 30, games: 1 },
    ]);
    expect(b.games.map((g) => [g.name, g.minutes])).toEqual([
      ["Persona 5 Royal", 60],
      ["Hades", 30],
      ["Undertale", 20],
    ]);

    const old = getPeriodBreakdown(ctx, { today: TEST_TODAY, year: 2025 });
    expect(old).toMatchObject({ totalMinutes: 500, year: 2025 });
    expect(old.genres).toEqual([{ genre: "Role-playing (RPG)", minutes: 500, games: 1 }]);
  });
});
