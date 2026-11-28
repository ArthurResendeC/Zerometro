import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import {
  achievementSets,
  achievementUnlocks,
  achievements,
  libraryEntries,
  user,
  userAchievementSets,
} from "../db/schema";
import { NotFoundError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import { markCompleted } from "./completions";
import type { ServiceContext } from "./context";
import { getGameInGroup, getLeaderboard, getMemberProfile, groupPeriodRange } from "./group";
import { addToLibrary } from "./library";
import { logSession } from "./sessions";
import { updateSettings } from "./settings";
import { startTimer } from "./timer";

// TEST_TODAY é 2026-11-19 (quinta-feira).
const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
]);
let db: Db;
let ana: ServiceContext;
let bia: ServiceContext;
let gameId: number;

function member(id: string, handle: string): ServiceContext {
  const ctx = createTestContext({ db, userId: id });
  db.update(user).set({ handle, name: handle.toUpperCase() }).where(eq(user.id, id)).run();
  return ctx;
}

beforeEach(async () => {
  db = createTestDb();
  ana = member("u-ana", "ana");
  bia = member("u-bia", "bia");
  gameId = (await addToLibrary(ana, igdb, { igdbId: 114283, status: "playing" })).gameId;
  await addToLibrary(bia, igdb, { igdbId: 114283, status: "playing" });
});

const byHandle = (ctx: ServiceContext, period: Parameters<typeof getLeaderboard>[1]) =>
  Object.fromEntries(getLeaderboard(ctx, period).members.map((m) => [m.handle, m]));

describe("período", () => {
  test("semana começa na segunda; mês e ano no dia 1; sempre desde o começo", () => {
    expect(groupPeriodRange("week", TEST_TODAY)).toEqual({ from: "2026-11-16", to: TEST_TODAY });
    expect(groupPeriodRange("month", TEST_TODAY).from).toBe("2026-11-01");
    expect(groupPeriodRange("year", TEST_TODAY).from).toBe("2026-01-01");
    expect(groupPeriodRange("all", TEST_TODAY).from).toBe("0000-01-01");
  });
});

describe("ranking", () => {
  test("horas, dias e o mais jogado contam só as sessões do período", () => {
    logSession(ana, { gameId, minutes: 60, playedOn: "2026-11-18" });
    logSession(ana, { gameId, minutes: 30, playedOn: "2026-11-02" });
    logSession(bia, { gameId, minutes: 200, playedOn: "2026-10-30" });

    const week = byHandle(ana, "week");
    expect(week.ana).toMatchObject({ minutes: 60, playedDays: 1, isMe: true });
    expect(week.ana!.topGame).toMatchObject({ igdbId: 114283, minutes: 60 });
    expect(week.bia).toMatchObject({ minutes: 0, playedDays: 0, topGame: null, isMe: false });
    expect(byHandle(ana, "month").ana!.minutes).toBe(90);
    expect(byHandle(ana, "year").bia!.minutes).toBe(200);
  });

  test('em "sempre", as horas são o total da biblioteca (com o tempo de antes)', () => {
    logSession(bia, { gameId, minutes: 30, playedOn: "2026-11-10" });
    db.update(libraryEntries)
      .set({ priorMinutes: 600 })
      .where(eq(libraryEntries.userId, "u-bia"))
      .run();
    expect(byHandle(ana, "all").bia!.minutes).toBe(630);
    expect(byHandle(ana, "month").bia!.minutes).toBe(30);
  });

  test("zerados: só a primeira conclusão de cada jogo conta, e 100% à parte", () => {
    markCompleted(ana, gameId, { type: "main", date: "2025-12-01" });
    markCompleted(ana, gameId, { type: "full", date: "2026-11-17" });
    markCompleted(bia, gameId, { type: "main", date: "2026-11-18" });

    const week = byHandle(ana, "week");
    expect(week.ana).toMatchObject({ finished: 0, fullCompletions: 1 }); // replay não conta
    expect(week.bia).toMatchObject({ finished: 1, fullCompletions: 0 });
    expect(byHandle(ana, "all").ana!.finished).toBe(1);
  });

  test("conquistas no período e a mais rara", () => {
    const set = db
      .insert(achievementSets)
      .values({ source: "steam", externalId: "1", fetchedAt: "2026-11-01T00:00:00.000Z" })
      .returning()
      .get();
    const [common, rare] = db
      .insert(achievements)
      .values([
        { setId: set.id, externalId: "a", title: "Comum", rarity: 80 },
        { setId: set.id, externalId: "b", title: "Rara", rarity: 1.5 },
      ])
      .returning()
      .all();
    db.insert(userAchievementSets).values({ userId: "u-ana", gameId, setId: set.id }).run();
    db.insert(achievementUnlocks)
      .values([
        { userId: "u-ana", achievementId: common!.id, unlockedAt: "2026-11-18T10:00:00.000Z" },
        { userId: "u-ana", achievementId: rare!.id, unlockedAt: "2026-10-01T10:00:00.000Z" },
      ])
      .run();

    expect(byHandle(ana, "week").ana).toMatchObject({
      achievements: 1,
      rarestAchievement: { title: "Comum", rarity: 80, igdbId: 114283 },
    });
    expect(byHandle(ana, "year").ana).toMatchObject({
      achievements: 2,
      rarestAchievement: { title: "Rara", rarity: 1.5 },
    });
  });

  test("ofensiva com o mínimo de cada um e o jogo do timer rodando", () => {
    logSession(bia, { gameId, minutes: 20, playedOn: "2026-11-18" });
    logSession(bia, { gameId, minutes: 20, playedOn: TEST_TODAY });
    expect(byHandle(ana, "week").bia!.streak).toBe(0); // mínimo padrão de 30min
    updateSettings(bia, { streakMinMinutes: 15 });
    expect(byHandle(ana, "week").bia!.streak).toBe(2);

    startTimer(ana, { gameId });
    expect(byHandle(bia, "week").ana!.playingNow).toMatchObject({ igdbId: 114283 });
  });

  test("quem desliga o compartilhamento, está suspenso ou não tem @apelido fica de fora", () => {
    expect(Object.keys(byHandle(ana, "week")).toSorted()).toEqual(["ana", "bia", "owner"]);
    updateSettings(bia, { shareWithGroup: false });
    db.update(user)
      .set({ disabledAt: "2026-11-01T00:00:00.000Z" })
      .where(eq(user.id, "owner"))
      .run();
    createTestContext({ db, userId: "sem-apelido" });

    expect(Object.keys(byHandle(ana, "week"))).toEqual(["ana"]);
    const seenByBia = getLeaderboard(bia, "week");
    expect(seenByBia.meHidden).toBe(true);
    expect(seenByBia.members.map((m) => m.handle)).toEqual(["ana"]);
  });

  test("nunca expõe preço nem notas de sessão", () => {
    logSession(ana, { gameId, minutes: 60, note: "segredo: chefe do palácio 3" });
    db.update(libraryEntries).set({ pricePaidCents: 19990, store: "Steam" }).run();
    const text = JSON.stringify([
      getLeaderboard(bia, "all"),
      getMemberProfile(bia, "ana"),
      getGameInGroup(bia, 114283),
    ]);
    expect(text).not.toContain("19990");
    expect(text).not.toContain("segredo");
    expect(text).not.toContain("price");
  });
});

describe("perfil de alguém do grupo", () => {
  test("em andamento, conclusões recentes e totais", async () => {
    const undertale = (await addToLibrary(ana, igdb, { igdbId: 12517, status: "backlog" })).gameId;
    markCompleted(ana, undertale, { type: "main", date: "2026-11-01" });
    logSession(ana, { gameId, minutes: 45 });

    const profile = getMemberProfile(bia, "ana");
    expect(profile.member).toMatchObject({ handle: "ana", isMe: false });
    expect(profile.playing.map((g) => g.name)).toEqual(["Persona 5 Royal"]);
    expect(profile.recentlyFinished).toMatchObject([
      { name: "Undertale", type: "main", completedOn: "2026-11-01" },
    ]);
    expect(profile.totals).toMatchObject({ minutes: 45, finished: 1, games: 2 });
  });

  test("quem não está no grupo: 404", () => {
    updateSettings(ana, { shareWithGroup: false });
    expect(() => getMemberProfile(bia, "ana")).toThrow(NotFoundError);
    expect(() => getMemberProfile(bia, "ninguem")).toThrow(NotFoundError);
  });
});

describe("o jogo no grupo", () => {
  test("quem tem o jogo, os que mais jogaram primeiro; jogo desconhecido: lista vazia", () => {
    logSession(bia, { gameId, minutes: 120 });
    logSession(ana, { gameId, minutes: 30 });
    markCompleted(bia, gameId, { type: "main" });

    const entries = getGameInGroup(ana, 114283);
    expect(
      entries.map((e) => [e.member.handle, e.minutesPlayed, e.completion?.best ?? null]),
    ).toEqual([
      ["bia", 120, "main"],
      ["ana", 30, null],
    ]);
    expect(getGameInGroup(ana, 999)).toEqual([]);
  });
});
