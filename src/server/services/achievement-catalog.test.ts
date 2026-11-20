import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { achievementSets, achievements } from "../db/schema";
import { AchievementSourceError, NotFoundError } from "../errors";
import {
  createFakeRa,
  createFakeSource,
  createTestCatalog,
  createTestClock,
  fakeRaGame,
  fakeSteamSet,
  TEST_NOW,
} from "../testing";
import { SET_TTL_MS } from "./achievement-catalog";

const DAY = 24 * 60 * 60 * 1000;

function setup(options: { failWith?: Error } = {}) {
  const db = createTestDb();
  const clock = createTestClock();
  const steam = createFakeSource([fakeSteamSet()], options);
  const retroachievements = createFakeRa(undefined, { 3: [fakeRaGame()] });
  const catalog = createTestCatalog(db, clock, { steam, retroachievements });
  const rows = (setId: number) =>
    db.select().from(achievements).where(eq(achievements.setId, setId)).all();
  return { db, clock, steam, retroachievements, catalog, rows };
}

describe("ensureSet", () => {
  test("busca na fonte uma vez e guarda a lista com as conquistas", async () => {
    const { catalog, steam, rows } = setup();

    const set = await catalog.ensureSet("steam", "1687950");
    await catalog.ensureSet("steam", "1687950");

    expect(steam.calls).toEqual([1687950]);
    expect(set).toMatchObject({ source: "steam", title: "Persona 5 Royal" });
    expect(set.fetchedAt).toBe(TEST_NOW.toISOString());
    expect(rows(set.id).map((a) => [a.externalId, a.hidden, a.rarity])).toEqual([
      ["ACH_1", false, 80],
      ["ACH_2", false, 30],
      ["ACH_3", true, 8],
    ]);
  });

  test("chamadas simultâneas compartilham a mesma busca", async () => {
    const { catalog, steam } = setup();
    await Promise.all([
      catalog.ensureSet("steam", "1687950"),
      catalog.ensureSet("steam", "1687950"),
    ]);
    expect(steam.calls).toHaveLength(1);
  });

  test("vencida (30 dias): atualiza no lugar, mantém ids e marca a que sumiu", async () => {
    const { catalog, steam, clock, rows } = setup();
    const first = await catalog.ensureSet("steam", "1687950");
    const before = rows(first.id);

    const [a1, , a3] = steam.sets[0]!.achievements;
    steam.sets[0]!.achievements = [
      { ...a1!, title: "Primeiro palácio (novo)" },
      a3!,
      { ...a3!, externalId: "ACH_4", title: "Nova", sortOrder: 3 },
    ];
    clock.set(new Date(TEST_NOW.getTime() + SET_TTL_MS));
    const again = await catalog.ensureSet("steam", "1687950");

    expect(again.id).toBe(first.id);
    const after = rows(first.id);
    const byExt = new Map(after.map((a) => [a.externalId, a]));
    expect(byExt.get("ACH_1")?.id).toBe(before[0]!.id);
    expect(byExt.get("ACH_1")?.title).toBe("Primeiro palácio (novo)");
    expect(byExt.get("ACH_2")?.removedAt).toBe(again.fetchedAt);
    expect(byExt.get("ACH_4")?.removedAt).toBeNull();

    // Voltou na fonte: deixa de estar removida.
    steam.sets[0]!.achievements = fakeSteamSet().achievements;
    await catalog.ensureSet("steam", "1687950", { force: true });
    expect(rows(first.id).find((a) => a.externalId === "ACH_2")?.removedAt).toBeNull();
  });

  test("fonte fora do ar: a lista guardada continua valendo; sem lista, o erro sobe", async () => {
    const { db, clock } = setup();
    const ok = createTestCatalog(db, clock);
    await ok.ensureSet("steam", "1687950");

    const failing = createTestCatalog(db, clock, {
      steam: createFakeSource([], { failWith: new AchievementSourceError("fora do ar") }),
    });
    const stored = await failing.ensureSet("steam", "1687950", { force: true });
    expect(stored.externalId).toBe("1687950");
    await expect(failing.ensureSet("steam", "1")).rejects.toBeInstanceOf(AchievementSourceError);
  });

  test("fonte sem conquistas para o id → NotFoundError, nada gravado", async () => {
    const { catalog, db } = setup();
    await expect(catalog.ensureSet("steam", "999")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.select().from(achievementSets).all()).toHaveLength(0);
  });
});

describe("refreshIfStale", () => {
  test("só busca de novo quando venceu, em segundo plano", async () => {
    const { catalog, steam, clock } = setup();
    const set = await catalog.ensureSet("steam", "1687950");

    catalog.refreshIfStale(set);
    await catalog.settled();
    expect(steam.calls).toHaveLength(1);

    clock.set(new Date(TEST_NOW.getTime() + 31 * DAY));
    catalog.refreshIfStale(set);
    await catalog.settled();
    expect(steam.calls).toHaveLength(2);
  });
});

describe("raGames", () => {
  test("guarda a lista do console no kv", async () => {
    const { catalog, retroachievements } = setup();
    expect(await catalog.raGames(3)).toEqual([fakeRaGame()]);
    await catalog.raGames(3);
    expect(retroachievements.listCalls).toEqual([3]);
  });
});
