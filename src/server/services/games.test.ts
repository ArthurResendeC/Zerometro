import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { companies, gameCompanies, gameSeries, series } from "../db/schema";
import { NotFoundError } from "../errors";
import { createFakeIgdb, fakeIgdbGame } from "../testing";
import {
  ensureGame,
  findGameByIgdbId,
  IGDB_META_VERSION,
  saveGame,
  syncGameFromIgdb,
} from "./games";

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
      steamAppId: 1687950,
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

/** Empresas e séries ligadas ao jogo, por nome. */
const linksOf = (gameId: number) => ({
  companies: db
    .select({
      name: companies.name,
      developer: gameCompanies.developer,
      publisher: gameCompanies.publisher,
    })
    .from(gameCompanies)
    .innerJoin(companies, eq(companies.id, gameCompanies.companyId))
    .where(eq(gameCompanies.gameId, gameId))
    .orderBy(companies.name)
    .all(),
  series: db
    .select({ kind: series.kind, name: series.name })
    .from(gameSeries)
    .innerJoin(series, eq(series.id, gameSeries.seriesId))
    .where(eq(gameSeries.gameId, gameId))
    .orderBy(series.kind)
    .all(),
});

describe("saveGame: empresas e séries", () => {
  test("grava temas, modos, empresas e séries", () => {
    const game = saveGame(db, fakeIgdbGame());

    expect(game).toMatchObject({
      themes: ["Fantasy", "Drama"],
      gameModes: ["Single player"],
      perspectives: ["Third person"],
      metaVersion: IGDB_META_VERSION,
    });
    expect(linksOf(game.id)).toEqual({
      companies: [
        { name: "Atlus", developer: true, publisher: true },
        { name: "Sega", developer: false, publisher: true },
      ],
      series: [
        { kind: "collection", name: "Persona" },
        { kind: "franchise", name: "Megami Tensei" },
      ],
    });
  });

  test("atualizar troca os links sem duplicar empresas compartilhadas", () => {
    saveGame(db, fakeIgdbGame());
    saveGame(db, fakeIgdbGame({ igdbId: 1, name: "Persona 4 Golden", franchises: [] }));
    const updated = saveGame(
      db,
      fakeIgdbGame({
        companies: [{ igdbId: 112, name: "SEGA", developer: false, publisher: true }],
      }),
    );

    expect(linksOf(updated.id).companies).toEqual([
      { name: "SEGA", developer: false, publisher: true },
    ]);
    // A empresa é a mesma linha para os dois jogos (o nome novo vale para todos).
    expect(db.select().from(companies).all()).toHaveLength(2);
    expect(db.select().from(series).all()).toHaveLength(2);
  });
});
