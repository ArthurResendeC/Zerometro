import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { activityLog, games } from "../db/schema";
import { AchievementSourceError, NotFoundError, ValidationError } from "../errors";
import {
  createFakeIgdb,
  createFakeRa,
  createFakeSource,
  createTestCatalog,
  createTestContext,
  fakeIgdbGame,
  fakeRaGame,
  fakeRaSet,
  fakeSteamSet,
} from "../testing";
import type { AchievementCatalog } from "./achievement-catalog";
import {
  findSetCandidates,
  linkSet,
  listGameAchievements,
  refreshGameSets,
  unlinkSet,
} from "./achievements";
import type { ServiceContext } from "./context";
import { addToLibrary } from "./library";

const P5R = fakeIgdbGame();
const METROID = fakeIgdbGame({
  igdbId: 1103,
  name: "Super Metroid",
  platforms: ["SNES", "Wii U"],
  steamAppId: null,
});
const igdb = createFakeIgdb([P5R, METROID]);

let ctx: ServiceContext;
let catalog: AchievementCatalog;
let p5r: number;
let metroid: number;

beforeEach(async () => {
  ctx = createTestContext();
  catalog = createTestCatalog(ctx.db);
  p5r = (await addToLibrary(ctx, igdb, { igdbId: P5R.igdbId, status: "playing" })).gameId;
  metroid = (await addToLibrary(ctx, igdb, { igdbId: METROID.igdbId, status: "playing" })).gameId;
});

describe("findSetCandidates", () => {
  test("Steam pelo appid do IGDB, com o total de conquistas", async () => {
    const result = await findSetCandidates(ctx, catalog, igdb, p5r);

    expect(result.sources).toEqual({ steam: true, retroachievements: true });
    expect(result.candidates).toEqual([
      {
        source: "steam",
        externalId: "1687950",
        title: "Persona 5 Royal",
        platform: null,
        iconUrl: null,
        achievementsCount: 3,
        points: null,
        via: "igdb",
        subset: false,
        linked: false,
      },
    ]);
    expect(result.consoles).toEqual([]);
  });

  test("RA pelo nome nos consoles das plataformas do jogo", async () => {
    const result = await findSetCandidates(ctx, catalog, igdb, metroid);

    expect(result.consoles).toEqual([{ id: 3, name: "SNES/Super Famicom" }]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        source: "retroachievements",
        externalId: "1446",
        title: "Super Metroid",
        achievementsCount: 2,
        points: 15,
        via: "name",
        linked: false,
      }),
    ]);
  });

  test("outro nome e outro console escolhidos pelo usuário", async () => {
    const ra = createFakeRa([], { 7: [fakeRaGame({ id: 50, title: "Metroid", consoleId: 7 })] });
    catalog = createTestCatalog(ctx.db, undefined, { retroachievements: ra });

    const result = await findSetCandidates(ctx, catalog, igdb, metroid, {
      q: "Metroid",
      consoleId: 7,
    });

    expect(ra.listCalls).toEqual([7]);
    expect(result.consoles).toEqual([{ id: 7, name: "NES/Famicom" }]);
    expect(result.candidates.map((c) => c.externalId)).toEqual(["50"]);
  });

  test("jogo antigo no cache sem appid: busca de novo no IGDB", async () => {
    ctx.db.update(games).set({ steamAppId: null }).where(eq(games.id, p5r)).run();
    const fresh = createFakeIgdb([P5R]);

    const result = await findSetCandidates(ctx, catalog, fresh, p5r);

    expect(fresh.calls.getGame).toEqual([P5R.igdbId]);
    expect(result.candidates[0]?.externalId).toBe("1687950");
  });

  test("fonte que falha vai para errors; fonte sem chave nem é consultada", async () => {
    catalog = createTestCatalog(ctx.db, undefined, {
      steam: createFakeSource([], { failWith: new AchievementSourceError("Steam fora do ar") }),
      retroachievements: createFakeRa([], {}, { enabled: false }),
    });

    const result = await findSetCandidates(ctx, catalog, igdb, p5r);

    expect(result.sources).toEqual({ steam: true, retroachievements: false });
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([{ source: "steam", message: "Steam fora do ar" }]);
  });

  test("marca o que já está ligado", async () => {
    await linkSet(ctx, catalog, p5r, { source: "steam", id: "1687950" });
    const result = await findSetCandidates(ctx, catalog, igdb, p5r);
    expect(result.candidates[0]?.linked).toBe(true);
  });
});

describe("linkSet / listGameAchievements", () => {
  test("liga pela URL da loja e lista as conquistas com o progresso", async () => {
    const result = await linkSet(ctx, catalog, p5r, {
      source: "steam",
      id: "https://store.steampowered.com/app/1687950/Persona_5_Royal/",
    });

    expect(result.summary).toEqual({ total: 3, unlocked: 0, points: 0, pointsUnlocked: 0 });
    const [set] = result.sets;
    expect(set).toMatchObject({
      source: "steam",
      externalId: "1687950",
      url: "https://store.steampowered.com/app/1687950/",
      total: 3,
      unlocked: 0,
    });
    expect(set?.achievements.map((a) => [a.title, a.hidden, a.unlockedAt])).toEqual([
      ["Primeiro palácio", false, null],
      ["Confidente máximo", false, null],
      ["Final verdadeiro", true, null],
    ]);
    expect(ctx.db.select().from(activityLog).all().at(-1)?.action).toBe("achievements.link");
  });

  test("Steam + RA no mesmo jogo somam no resumo (pontos só do RA)", async () => {
    await linkSet(ctx, catalog, metroid, { source: "retroachievements", id: "1446" });
    const result = await linkSet(ctx, catalog, metroid, { source: "steam", id: "1687950" });

    expect(result.sets.map((s) => s.source)).toEqual(["retroachievements", "steam"]);
    expect(result.summary).toEqual({ total: 5, unlocked: 0, points: 15, pointsUnlocked: 0 });
  });

  test("ligar de novo não duplica", async () => {
    await linkSet(ctx, catalog, p5r, { source: "steam", id: "1687950" });
    const again = await linkSet(ctx, catalog, p5r, { source: "steam", id: "1687950" });
    expect(again.sets).toHaveLength(1);
  });

  test("id que não é da fonte, jogo sem conquistas e jogo fora da biblioteca", async () => {
    await expect(
      linkSet(ctx, catalog, p5r, { source: "steam", id: "retroachievements.org/game/1446" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(linkSet(ctx, catalog, p5r, { source: "steam", id: "42" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(() => listGameAchievements(ctx, catalog, 9999)).toThrow(NotFoundError);
  });

  test("sem listas: summary null", () => {
    expect(listGameAchievements(ctx, catalog, p5r)).toMatchObject({ sets: [], summary: null });
  });
});

describe("unlinkSet / refreshGameSets", () => {
  test("desliga só do jogo pedido", async () => {
    const linked = await linkSet(ctx, catalog, p5r, { source: "steam", id: "1687950" });
    await linkSet(ctx, catalog, metroid, { source: "steam", id: "1687950" });
    const setId = linked.sets[0]!.id;

    expect(unlinkSet(ctx, catalog, p5r, setId).sets).toEqual([]);
    expect(listGameAchievements(ctx, catalog, metroid).sets).toHaveLength(1);
    expect(() => unlinkSet(ctx, catalog, p5r, setId)).toThrow(NotFoundError);
  });

  test("atualizar busca de novo na fonte", async () => {
    const steam = createFakeSource([fakeSteamSet()]);
    catalog = createTestCatalog(ctx.db, undefined, { steam });
    await linkSet(ctx, catalog, p5r, { source: "steam", id: "1687950" });
    steam.sets[0]!.achievements[0]!.title = "Renomeada";

    const result = await refreshGameSets(ctx, catalog, p5r);

    expect(steam.calls).toHaveLength(2);
    expect(result.sets[0]?.achievements[0]?.title).toBe("Renomeada");
  });

  test("RA usa os badges e a plataforma da fonte", async () => {
    const result = await linkSet(ctx, catalog, metroid, {
      source: "retroachievements",
      id: "https://retroachievements.org/game/1446",
    });
    expect(result.sets[0]).toMatchObject({
      title: fakeRaSet().title,
      platform: "SNES/Super Famicom",
      url: "https://retroachievements.org/game/1446",
    });
  });
});
