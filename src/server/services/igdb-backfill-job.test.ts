import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { games } from "../db/schema";
import { createFakeIgdb, fakeIgdbGame } from "../testing";
import { IGDB_META_VERSION, saveGame } from "./games";
import { runIgdbBackfill } from "./igdb-backfill-job";

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

/** Grava como um jogo de antes dos metadados novos (sem temas e com versão 0). */
function saveOld(igdbId: number, name: string) {
  saveGame(db, fakeIgdbGame({ igdbId, name, themes: [], companies: [], collections: [] }));
  db.update(games).set({ metaVersion: 0 }).where(eq(games.igdbId, igdbId)).run();
}

describe("runIgdbBackfill", () => {
  test("busca de novo só os desatualizados e marca os que sumiram do IGDB", async () => {
    saveOld(1, "Antigo");
    saveOld(2, "Removido do IGDB");
    saveGame(db, fakeIgdbGame({ igdbId: 3, name: "Novo" }));
    const igdb = createFakeIgdb([fakeIgdbGame({ igdbId: 1, name: "Antigo" })]);

    expect(await runIgdbBackfill(db, igdb)).toBe(1);

    expect(igdb.calls.getGames).toEqual([[1, 2]]);
    const rows = db.select().from(games).orderBy(games.igdbId).all();
    expect(rows.map((g) => [g.igdbId, g.metaVersion, g.themes])).toEqual([
      [1, IGDB_META_VERSION, ["Fantasy", "Drama"]],
      [2, IGDB_META_VERSION, []],
      [3, IGDB_META_VERSION, ["Fantasy", "Drama"]],
    ]);
    // Segunda rodada: nada a fazer.
    expect(await runIgdbBackfill(db, igdb)).toBe(0);
    expect(igdb.calls.getGames).toHaveLength(1);
  });
});
