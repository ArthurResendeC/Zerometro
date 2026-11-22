import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { achievementUnlocks, libraryEntries, playSessions } from "../db/schema";
import {
  createFakeIgdb,
  createTestCatalog,
  createTestContext,
  fakeIgdbGame,
  TEST_TODAY,
} from "../testing";
import { linkSet, setAchievementUnlocked } from "./achievements";
import { markCompleted } from "./completions";
import type { ServiceContext } from "./context";
import { addToLibrary, updateLibraryEntry } from "./library";
import { getRecap } from "./recap";
import { logSession } from "./sessions";

// TEST_TODAY = 2026-11-19, uma quinta-feira. Semana passada: 09 a 15/11; a retrasada: 02 a 08/11.

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 113112, name: "Hades", genres: ["Role-playing (RPG)", "Indie"] }),
  fakeIgdbGame({ igdbId: 1942, name: "The Witcher 3", genres: ["Adventure"] }),
]);

let ctx: ServiceContext;
let persona: number;
let undertale: number;

beforeEach(async () => {
  ctx = createTestContext();
  persona = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
  undertale = (await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" })).gameId;
});

const add = async (igdbId: number) =>
  (await addToLibrary(ctx, igdb, { igdbId, status: "playing" })).gameId;

function play(playedOn: string, minutes: number, gameId = persona) {
  logSession(ctx, { gameId, minutes, playedOn });
}

/** Sessão de timer entre dois instantes UTC. */
function timed(playedOn: string, startedAt: string, endedAt: string, gameId = persona) {
  const minutes = (Date.parse(endedAt) - Date.parse(startedAt)) / 60_000;
  ctx.db
    .insert(playSessions)
    .values({ userId: ctx.userId, gameId, playedOn, minutes, startedAt, endedAt, source: "timer" })
    .run();
}

const recap = (period: "week" | "month" = "week", date?: string) =>
  getRecap(ctx, { today: TEST_TODAY, timeZone: "America/Sao_Paulo", period, date });

describe("período", () => {
  test("sem data, a semana passada; compara com a retrasada", () => {
    play("2026-11-03", 100); // retrasada
    play("2026-11-10", 60);
    play("2026-11-11", 30, undertale);
    play("2026-11-11", 45);
    play("2026-11-12", 20, undertale);
    play("2026-11-15", 90);
    play("2026-11-17", 999); // semana atual: fora

    const r = recap();

    expect(r).toMatchObject({
      period: "week",
      from: "2026-11-09",
      to: "2026-11-15",
      inProgress: false,
      previous: "2026-11-02",
      next: "2026-11-16",
      totalMinutes: 245,
      previousMinutes: 100,
      sessions: 5,
      playedDays: 4,
      longestRun: 3, // 10, 11 e 12
      gamesPlayed: 2,
      bestDay: { date: "2026-11-15", minutes: 90 },
      longestSession: { minutes: 90, playedOn: "2026-11-15", name: "Persona 5 Royal" },
    });
    expect(r.daily.map((d) => d.minutes)).toEqual([0, 60, 75, 20, 0, 0, 90]);
    expect(r.topGames.map((g) => [g.name, g.minutes, g.sessions])).toEqual([
      ["Persona 5 Royal", 195, 3],
      ["Undertale", 50, 2],
    ]);
    expect(r.topGenres).toEqual([{ genre: "Role-playing (RPG)", minutes: 245, games: 2 }]);
  });

  test("semana atual em andamento, sem próxima; data no futuro vira o período atual", () => {
    play("2026-11-17", 30);
    const r = recap("week", "2026-12-25");
    expect(r).toMatchObject({
      from: "2026-11-16",
      to: "2026-11-22",
      inProgress: true,
      next: null,
      totalMinutes: 30,
    });
    expect(r.daily).toHaveLength(7);
  });

  test("mês: sem período anterior antes do primeiro dia jogado", () => {
    play("2026-10-05", 40);
    play("2026-10-20", 20, undertale);

    const october = recap("month");
    expect(october).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      previous: null,
      next: "2026-11-01",
      totalMinutes: 60,
      previousMinutes: 0,
    });
    expect(october.daily).toHaveLength(31);

    expect(recap("month", "2026-11-19")).toMatchObject({ previous: "2026-10-01", next: null });
  });

  test("período vazio", () => {
    const r = recap();
    expect(r).toMatchObject({
      totalMinutes: 0,
      playedDays: 0,
      longestRun: 0,
      topGames: [],
      bestDay: null,
      longestSession: null,
      previous: null,
      achievements: { unlocked: 0, games: 0, rarest: null },
      profile: { timedMinutes: 0, dayPart: null, dayPartShare: null, weekendShare: null },
    });
  });
});

describe("estreias e retornos", () => {
  test("estreia só sem tempo anterior; retorno depois de 30 dias parado", async () => {
    const hades = await add(113112);
    const witcher = await add(1942);
    play("2026-09-01", 60); // Persona: última antes do período
    play("2026-11-10", 30); // volta 70 dias depois
    play("2026-10-20", 30, undertale); // Undertale: só 21 dias parado
    play("2026-11-11", 30, undertale);
    play("2026-11-12", 30, hades); // 1ª sessão, mas tinha tempo de antes
    updateLibraryEntry(ctx, hades, { priorMinutes: 600 });
    // The Witcher 3: 1ª sessão no período, sem tempo anterior.
    play("2026-11-13", 45, witcher);

    const r = recap();
    expect(r.newGames.map((g) => g.name)).toEqual(["The Witcher 3"]);
    expect(r.returningGames.map((g) => [g.name, g.daysAway])).toEqual([["Persona 5 Royal", 70]]);
  });

  test("o que a Steam já tinha antes da primeira sincronização não é estreia", async () => {
    const witcher = await add(1942);
    play("2026-11-13", 45, witcher);
    // Base da Steam: 5000 min já contados, só 45 em sessões.
    ctx.db
      .update(libraryEntries)
      .set({ steamCountedMinutes: 5045 })
      .where(eq(libraryEntries.gameId, witcher))
      .run();
    expect(recap().newGames).toEqual([]);

    // Base só com o que foi jogado no Zerômetro (o timer avança a base): continua estreia.
    ctx.db
      .update(libraryEntries)
      .set({ steamCountedMinutes: 45 })
      .where(eq(libraryEntries.gameId, witcher))
      .run();
    expect(recap().newGames.map((g) => g.name)).toEqual(["The Witcher 3"]);
  });
});

describe("zerados e conquistas", () => {
  test("zerados no período", () => {
    play("2026-11-12", 60);
    markCompleted(ctx, persona, { type: "main", date: "2026-11-14" });
    markCompleted(ctx, undertale, { type: "main", date: "2026-11-02" }); // retrasada

    const r = recap();
    expect(r.finished.map((g) => [g.name, g.type])).toEqual([["Persona 5 Royal", "main"]]);
    expect(r.finishedSummary).toEqual({ games: 1, replays: 0, full: 0 });
  });

  test("desbloqueios pelo dia local e a mais rara", async () => {
    const catalog = createTestCatalog(ctx.db);
    const { sets } = await linkSet(ctx, catalog, persona, { source: "steam", id: "1687950" });
    const [common, rare, rarest] = sets[0]!.achievements.map((a) => a.id) as [
      number,
      number,
      number,
    ];

    setAchievementUnlocked(ctx, catalog, persona, common, {
      unlocked: true,
      unlockedOn: "2026-11-10",
    });
    setAchievementUnlocked(ctx, catalog, persona, rare, {
      unlocked: true,
      unlockedOn: "2026-11-12",
    });
    // 02:00 UTC do dia 9 ainda é 23:00 do dia 8 em São Paulo: fica de fora.
    setAchievementUnlocked(ctx, catalog, persona, rarest, { unlocked: true });
    ctx.db
      .update(achievementUnlocks)
      .set({ unlockedAt: "2026-11-09T02:00:00.000Z" })
      .where(eq(achievementUnlocks.achievementId, rarest))
      .run();

    expect(recap().achievements).toEqual({
      unlocked: 2,
      games: 1,
      rarest: {
        title: "Confidente máximo",
        iconUrl: "https://cdn.steam/ACH_2.jpg",
        rarity: 30,
        gameId: persona,
        igdbId: 114283,
        gameName: "Persona 5 Royal",
        unlockedOn: "2026-11-12",
      },
    });

    // Já 02:00 UTC do dia 16 é 23:00 do dia 15: conta na semana passada e vira a mais rara.
    ctx.db
      .update(achievementUnlocks)
      .set({ unlockedAt: "2026-11-16T02:00:00.000Z" })
      .where(eq(achievementUnlocks.achievementId, rarest))
      .run();
    const { achievements } = recap();
    expect(achievements.unlocked).toBe(3);
    expect(achievements.rarest).toMatchObject({
      title: "Final verdadeiro",
      unlockedOn: "2026-11-15",
    });
  });
});

describe("perfil", () => {
  test("período do dia pelas sessões com horário; fatia do fim de semana pelo total", () => {
    // Noite: 20:30 às 22:15 em São Paulo (UTC-3), na quarta 11.
    timed("2026-11-11", "2026-11-11T23:30:00.000Z", "2026-11-12T01:15:00.000Z");
    // Manhã: 9h às 9h45 do sábado 14.
    timed("2026-11-14", "2026-11-14T12:00:00.000Z", "2026-11-14T12:45:00.000Z");
    play("2026-11-15", 30); // manual, sem horário: só no fim de semana

    expect(recap().profile).toEqual({
      timedMinutes: 150,
      dayPart: "night",
      dayPartShare: 0.7,
      weekendShare: 0.42, // (45 + 30) / 180
    });
  });

  test("pouco tempo com horário não dá perfil", () => {
    timed("2026-11-11", "2026-11-11T23:30:00.000Z", "2026-11-12T00:15:00.000Z");
    expect(recap().profile).toMatchObject({ timedMinutes: 45, dayPart: null, dayPartShare: null });
  });
});
