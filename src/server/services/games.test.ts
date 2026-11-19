import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, type Db } from "../db/client";
import { NotFoundError } from "../errors";
import { createFakeIgdb, fakeIgdbGame } from "../testing";
import { ensureGame, findGameByIgdbId, syncGameFromIgdb } from "./games";

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

describe("syncGameFromIgdb", () => {
  test("grava o jogo com tempo para zerar", async () => {
    const game = await syncGameFromIgdb(db, createFakeIgdb(), 114283);

    expect(game).toMatchObject({
      igdbId: 114283,
      name: "Persona 5 Royal",
      platforms: ["PS4", "PS5", "PC"],
      ttbMainSec: 315_000,
      ttbExtraSec: 424_580,
      ttbCompleteSec: 799_200,
      ttbSource: "igdb",
    });
    expect(game.syncedAt).not.toBeNull();
  });

  test("atualiza o cache existente sem duplicar", async () => {
    await syncGameFromIgdb(db, createFakeIgdb(), 114283);
    const renamed = createFakeIgdb([fakeIgdbGame({ name: "Persona 5 Royal (novo nome)" })]);

    const game = await syncGameFromIgdb(db, renamed, 114283);

    expect(game.name).toBe("Persona 5 Royal (novo nome)");
    expect(findGameByIgdbId(db, 114283)?.id).toBe(game.id);
  });

  test("sem tempo para zerar, ttb fica nulo", async () => {
    const igdb = createFakeIgdb([fakeIgdbGame({ timeToBeat: null })]);

    const game = await syncGameFromIgdb(db, igdb, 114283);

    expect(game).toMatchObject({ ttbMainSec: null, ttbSource: null });
  });

  test("jogo inexistente no IGDB → NotFoundError", async () => {
    await expect(syncGameFromIgdb(db, createFakeIgdb(), 1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ensureGame", () => {
  test("usa o cache e só chama o IGDB na primeira vez", async () => {
    const igdb = createFakeIgdb();

    const first = await ensureGame(db, igdb, 114283);
    const second = await ensureGame(db, igdb, 114283);

    expect(second.id).toBe(first.id);
    expect(igdb.calls.getGame).toEqual([114283]);
  });
});
